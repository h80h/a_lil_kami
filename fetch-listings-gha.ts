import { execSync } from "child_process";
import { existsSync } from "fs";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
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

interface SimpleListing {
  id: number;
  price: number;
  time: string;
  rawTime: string;
}

async function uploadListingsToR2(listings: Record<number, SimpleListing>, newListingId: string[], listingNewWindow: Record<string, number>) {
  const filename = "kamiListings.json";
  console.log(`\n📤 Uploading ${filename} to Cloudflare R2...`);

  const payload = {
    listings,
    newListingId,
    listingNewWindow,
  };

  const stream = Readable.from(JSON.stringify(payload));

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

async function fetchPreviousListings(): Promise<{ listings: Record<string, SimpleListing>; listingNewWindow: Record<string, number> }> {
  try {
    const cmd = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: "kamiListings.json" });
    const res = await r2Client.send(cmd);
    const body = await res.Body?.transformToString();
    if (!body) return { listings: {}, listingNewWindow: {} };
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "listings" in parsed) {
      return {
        listings: parsed.listings ?? {},
        listingNewWindow: parsed.listingNewWindow ?? {},
      };
    }
    // Legacy: entire object was the listings map
    return { listings: parsed ?? {}, listingNewWindow: {} };
  } catch {
    return { listings: {}, listingNewWindow: {} };
  }
}

async function main() {
  try {
    console.log("=".repeat(60));
    console.log("🛒 Kamigotchi Listings Fetch");
    console.log("=".repeat(60));

    const [response, { listings: prevListings, listingNewWindow: prevWindow }] = await Promise.all([
      fetchAllListings() as Promise<any>,
      fetchPreviousListings(),
    ]);

    // Each newly listed ID enters listingNewWindow with 13 runs remaining (including this run).
    // Every run decrements all counters. IDs reaching 0 are removed (~1 hour at 5-min intervals).
    const NEW_WINDOW_RUNS = 13;

    if (!response || !Array.isArray(response.Listings)) {
      throw new Error(`gRPC response malformed: expected response.Listings to be an array, got ${JSON.stringify(response)}`);
    }

    if (response.Listings.length > 0) {
      // Build a map keyed by KamiIndex for newListingId / listingNewWindow tracking
      const byId: Record<string, SimpleListing> = {};
      response.Listings.forEach((listing: { KamiIndex: string; Price: string; Timestamp: string }) => {
        // Convert raw timestamp to "Mar 8, 2026, 12:34:49 AM"
        const ts = Number(listing.Timestamp);
        const date = new Date(ts < 10000000000 ? ts * 1000 : ts);

        byId[listing.KamiIndex] = {
          id: Number(listing.KamiIndex),
          price: Number(BigInt(listing.Price)) / 1e18,
          time: date.toISOString(),       // The UI-friendly string
          rawTime: listing.Timestamp // The raw string for the filter logic
        };
      });

      // IDs that weren't in the previous snapshot, or whose time changed, are new listings
      const prevIdTimeMap = new Map(Object.values(prevListings).map(l => [String(l.id), l.rawTime]));

      const newListingId = Object.keys(byId).filter(id => {
        const prevTime = prevIdTimeMap.get(id);
        
        // Cast both sides to String to ensure the comparison is type-safe
        return prevTime === undefined || String(prevTime) !== String(byId[id].rawTime);
      });

      // Decrement existing entries; drop any that have expired or are no longer listed
      const listingNewWindow: Record<string, number> = {};
      for (const [id, remaining] of Object.entries(prevWindow)) {
        const next = remaining - 1;
        if (next > 0 && id in byId) listingNewWindow[id] = next;
      }
      // Add brand-new listing IDs
      for (const id of newListingId) {
        listingNewWindow[id] = NEW_WINDOW_RUNS;
      }

      if (newListingId.length > 0) {
        console.log(`\n✨ Found ${newListingId.length} new listing(s): ${newListingId.join(", ")}`);
      }
      console.log(`⏱️  IDs in listing-window: ${Object.keys(listingNewWindow).length > 0 ? Object.keys(listingNewWindow).join(", ") : "none"}`);

      // Build rank-keyed listings: sorted by price asc, ties broken by id asc
      const sortedEntries = Object.values(byId).sort((a, b) => a.id - b.id);
      const listings: Record<number, SimpleListing> = {};
      sortedEntries.forEach((item, i) => { listings[i + 1] = item; });

      console.log(`\nSuccessfully fetched ${sortedEntries.length} listings:`);
      console.dir(listings, { maxArrayLength: null });

      await uploadListingsToR2(listings, newListingId, listingNewWindow);
    } else {
      console.log("No active listings found.");
      await uploadListingsToR2({} as Record<number, SimpleListing>, [], {});
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