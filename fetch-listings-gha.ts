import { execSync } from "child_process";
import { existsSync } from "fs";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "stream";
import { createRequire } from "module";

// --- PROTO DOWNLOAD ---
if (!existsSync("./proto.ts")) {
  console.log("📥 Downloading proto.ts from GitHub...");
  execSync(
    "curl -fsSL -o proto.ts https://raw.githubusercontent.com/Asphodel-OS/kamigotchi/main/packages/client/src/clients/kamiden/proto.ts",
    { stdio: "inherit" }
  );
  console.log("   ✅ proto.ts downloaded");
}

// Initialize Cloudflare R2 client
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// createRequire lets us use require() inside an ES module context,
// which respects the tsx/cjs hook and can load .ts files directly
const require = createRequire(import.meta.url);

async function fetchAllListings() {
  const grpc = await import("nice-grpc-web");
  const { createChannel, createClient, ClientError } = grpc as any;

  // Use require() so tsx/cjs hook handles the .ts extension
  const { KamidenServiceDefinition } = require("./proto.ts") as any;

  const channel = createChannel("https://api.prod.kamigotchi.io");
  const client = createClient(KamidenServiceDefinition, channel) as any;

  while (true) {
    try {
      return await client.getKamiMarketListings({ Size: 500 }) as any;
    } catch (err: unknown) {
      if ((err as any)?.code === 8) {
        const waitMatch = (err as any).details?.match(/retry in ([\d.]+)s/);
        const waitSeconds = waitMatch ? parseFloat(waitMatch[1]) : 10;
        console.warn(`[Rate Limit] Waiting ${Math.ceil(waitSeconds)}s before retrying...`);
        await new Promise(resolve => setTimeout(resolve, (waitSeconds * 1000) + 500));
        continue;
      }
      throw err;
    }
  }
}

async function uploadListingsToR2(listings: Record<string, number>) {
  const filename = "kamiListings.json";
  console.log(`\n📤 Uploading ${filename} to Cloudflare R2...`);

  const stream = Readable.from(JSON.stringify(listings));

  const parallelUploads3 = new Upload({
    client: r2Client,
    params: {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: filename,
      Body: stream,
      ContentType: "application/json",
      CacheControl: "public, max-age=300",
    },
  });

  await parallelUploads3.done();
  console.log(`   ✅ ${filename} uploaded successfully`);
}

async function main() {
  try {
    console.log("=".repeat(60));
    console.log("🛒 Kamigotchi Listings Fetch");
    console.log("=".repeat(60));

    const response = await fetchAllListings() as any;

    if (response.Listings && response.Listings.length > 0) {
      const listings: Record<string, number> = {};
      response.Listings.forEach((listing: { KamiIndex: string; Price: string }) => {
        listings[listing.KamiIndex] = Number(BigInt(listing.Price)) / 1e18;
      });

      const sorted = Object.entries(listings).sort(([, a], [, b]) => a - b);
      console.log(`\nSuccessfully fetched ${sorted.length} listings:`);
      console.dir(Object.fromEntries(sorted), { maxArrayLength: null });

      await uploadListingsToR2(listings);
    } else {
      console.log("No active listings found.");
      await uploadListingsToR2({});
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Listings fetch & upload complete");
    console.log("=".repeat(60));
  } catch (err) {
    if (err instanceof Error) {
      console.error("Critical failure:", err.message);
    }
    process.exit(1);
  }
}

main();