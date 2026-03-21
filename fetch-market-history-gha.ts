/**
 * fetch-combined-gha.ts
 *
 * Merged script combining fetch-listings-gha.ts and fetch-history-backfill-gha.ts.
 * Runs as a single GHA job — no coordination needed between scripts.
 *
 * Concurrency model:
 *   - Feed stream starts immediately (deadline = 4.5 min)
 *   - Backfill gRPC calls (100 accounts) run concurrently with feed stream
 *   - Listings fetch runs concurrently with both
 *   - All three results merge into one kamiMarketHistory.json upload
 *
 * Env vars required:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

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

const require = createRequire(import.meta.url);

// ============================================================
// CONSTANTS (from fetch-history-backfill-gha.ts)
// ============================================================

const BATCH_SIZE          = 100;
const CURSOR_KEY          = "kamiMarketHistory-backfill-cursor.json";
const HISTORY_KEY         = "kamiMarketHistory.json";
const META_KEY            = "kamiMarketHistoryMeta.json";
const INTER_REQUEST_DELAY_MS = 2000;

// ============================================================
// SHARED HELPERS
// ============================================================

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      if ((err as any)?.code === 8) {
        const waitMatch = (err as any).details?.match(/retry in ([\d.]+)s/);
        const waitSeconds = waitMatch ? parseFloat(waitMatch[1]) : 10;
        console.warn(`[Rate Limit] Waiting ${Math.ceil(waitSeconds)}s before retrying...`);
        await sleep((waitSeconds * 1000) + 500);
        continue;
      }
      throw err;
    }
  }
}

// ============================================================
// GRPC CLIENT (initialised once, reused across all fetches)
// ============================================================

let _client: any = null;

async function getClient() {
  if (_client) return _client;
  const grpc = await import("nice-grpc-web");
  const { createChannel, createClient } = grpc as any;
  const { KamidenServiceDefinition } = require("./proto.ts") as any;
  const channel = createChannel("https://api.prod.kamigotchi.io");
  _client = createClient(KamidenServiceDefinition, channel);
  return _client;
}

// ============================================================
// TYPES
// ============================================================

interface SaleRecord {
  orderId: string;
  kamiId: number;
  price: number;
  seller: string;
  buyer: string;
  type: "listing" | "bid";
  time: string;
  tradeTime?: string;
  rawTime: string;
}

interface SimpleListing {
  id: number;
  price: number;
  time: string;
  rawTime: string;
}

interface RawListing {
  KamiIndex: string;
  Price: string;
  Timestamp: string;
  SellerAccountID: string;
  OrderID: string;
}

interface KamiAccount {
  name: string | null;
  id:   string | null;
  kamis: number[];
}

interface Cursor {
  nextIndex: number;
  total: number;
  completedAt?: string;
}

// ============================================================
// R2 HELPERS
// ============================================================

async function fetchFromR2<T>(key: string, fallback: T): Promise<T> {
  try {
    const cmd = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key });
    const res = await r2Client.send(cmd);
    const body = await res.Body?.transformToString();
    if (!body) return fallback;
    return JSON.parse(body) as T;
  } catch {
    return fallback;
  }
}

async function uploadToR2(key: string, payload: unknown, cacheControl = "public, max-age=300") {
  console.log(`\n📤 Uploading ${key} to Cloudflare R2...`);
  const upload = new Upload({
    client: r2Client,
    params: {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: Readable.from(JSON.stringify(payload)),
      ContentType: "application/json",
      CacheControl: cacheControl,
    },
  });
  await upload.done();
  console.log(`   ✅ ${key} uploaded successfully`);
}

async function fetchPreviousHistory(): Promise<{ history: SaleRecord[] }> {
  try {
    const cmd = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: HISTORY_KEY });
    const res = await r2Client.send(cmd);
    const body = await res.Body?.transformToString();
    if (!body) return { history: [] };
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "history" in parsed) {
      return { history: parsed.history ?? [] };
    }
    // Legacy: entire object was the bare array
    return { history: Array.isArray(parsed) ? parsed : [] };
  } catch {
    return { history: [] };
  }
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

// ============================================================
// LISTINGS (from fetch-listings-gha.ts, unchanged)
// ============================================================

async function fetchAllListings(): Promise<RawListing[]> {
  const client = await getClient();

  console.log(`   🔍 Fetching listings...`);
  const response = await callWithRetry(() => client.getKamiMarketListings({ Size: 500 })) as any;

  if (!response || !Array.isArray(response.Listings)) {
    throw new Error(`gRPC response malformed: expected response.Listings to be an array, got ${JSON.stringify(response)}`);
  }

  console.log(`   Found ${response.Listings.length} listings`);
  return response.Listings as RawListing[];
}

// ============================================================
// FEED (from fetch-listings-gha.ts, unchanged)
// ============================================================

async function fetchFeedTrades(deadlineMs: number): Promise<SaleRecord[]> {
  const client = await getClient();
  const trades: SaleRecord[] = [];
  const seen = new Set<string>();

  console.log(`\n📡 Listening to Feed stream until rest of run completes...`);

  while (Date.now() < deadlineMs) {
    try {
      const stream = client.subscribeToStream({ topics: [] }) as AsyncIterable<any>;

      for await (const response of stream) {
        if (Date.now() >= deadlineMs) break;

        const feed = response?.Feed;
        if (!feed) continue;

        const buys: any[]    = feed.KamiMarketBuys    ?? [];
        const accepts: any[] = feed.KamiMarketAccepts ?? [];

        for (const e of buys) {
          if (!e.OrderID || seen.has(e.OrderID)) continue;
          seen.add(e.OrderID);
          const ts = Number(e.Timestamp);
          const tsMs = ts < 10_000_000_000 ? ts * 1000 : ts;
          const iso = new Date(tsMs).toISOString();
          trades.push({
            orderId:   e.OrderID,
            kamiId:    Number(e.KamiIndex),
            price:     Number(BigInt(e.Price)) / 1e18,
            seller:    e.SellerAccountID,
            buyer:     e.BuyerAccountID,
            type:      "listing",
            time:      iso,
            tradeTime: iso,
            rawTime:   String(e.Timestamp),
          });
          console.log(`   🟢 KamiMarketBuy  #${e.KamiIndex} Ξ${Number(BigInt(e.Price)) / 1e18}`);
        }

        for (const e of accepts) {
          if (!e.OrderID || seen.has(e.OrderID)) continue;
          seen.add(e.OrderID);
          const ts = Number(e.Timestamp);
          const tsMs = ts < 10_000_000_000 ? ts * 1000 : ts;
          const iso = new Date(tsMs).toISOString();
          trades.push({
            orderId:   e.OrderID,
            kamiId:    Number(e.KamiIndex),
            price:     Number(BigInt(e.Price)) / 1e18,
            seller:    e.SellerAccountID,
            buyer:     e.BuyerAccountID,
            type:      "bid",
            time:      iso,
            tradeTime: iso,
            rawTime:   String(e.Timestamp),
          });
          console.log(`   🟣 KamiMarketAccept #${e.KamiIndex} Ξ${Number(BigInt(e.Price)) / 1e18}`);
        }
      }

    } catch (err: any) {
      const code = (err as any)?.code;
      if (code === 1 /* CANCELLED */ || Date.now() >= deadlineMs) break;
      console.warn(`   ⚠️  Feed stream error (code ${code}): ${err?.message}`);
      console.log("   🔄 Reconnecting in 5s...");
      await sleep(5000);
      continue;
    }

    if (Date.now() < deadlineMs) {
      console.log("   🔄 Stream ended, reconnecting in 5s...");
      await sleep(5000);
    }
  }

  console.log(`   📡 Feed done — ${trades.length} trade(s) caught`);
  return trades;
}

// ============================================================
// BACKFILL BATCH (from fetch-history-backfill-gha.ts, unchanged)
// ============================================================

async function fetchBackfillBatch(
  batch: KamiAccount[],
  existingHistoryMap: Map<string, SaleRecord>,
  bidDedupIndex: Set<string>,
  getBaseOrderId: (orderId: string) => string
): Promise<{ newRecords: SaleRecord[]; totalNewSales: number }> {
  const client = await getClient();
  const newRecords: SaleRecord[] = [];
  let totalNewSales = 0;

  // Warm-up
  console.log("\n⏳ Warming up backfill for 5s...");
  await sleep(5000);

  for (let i = 0; i < batch.length; i++) {
    const account   = batch[i];
    const accountId = account.id!;

    try {
      const response = await callWithRetry(() =>
        client.getKamiMarketHistory({ AccountId: accountId, Size: 500 })
      ) as any;

      if (!response || !Array.isArray(response.Orders)) {
        console.warn(`   [${i + 1}/${batch.length}] ⚠️  Unexpected response for ${accountId}, skipping`);
      } else {
        let newForAccount = 0;
        for (const order of response.Orders) {
          if (!order.Listing && !order.Bid) continue;

          // Partial-fill bid: BidType=1 with BoughtKamiIndexes means trades happened
          // even if the order is later canceled or not fully complete
          const boughtIndexes: number[] = order.Bid?.BoughtKamiIndexes ?? [];
          const isPartialBid =
            order.Bid?.BidType === 1 &&
            boughtIndexes.length > 0;

          // Skip canceled orders unless they are BidType=1 with completed trades
          if (order.IsCanceled && !isPartialBid) continue;

          if (!order.IsComplete && !isPartialBid) continue;

          const ts   = Number(order.Timestamp);
          const tsMs = ts < 10_000_000_000 ? ts * 1000 : ts;

          // For partial-fill bids, emit one record per bought kami index
          if (isPartialBid) {
            const price = Number(BigInt(order.Bid!.Price ?? "0")) / 1e18;
            const buyer = order.Bid!.BuyerAccountID ?? "";
            for (const ki of boughtIndexes) {
              const subId   = `${order.OrderID}-${ki}-${order.Timestamp}`;
              const existing = existingHistoryMap.get(subId);
              const isNew    = !existing;

              // Skip if a bid with the same base order + kamiId + seller already recorded
              const seller = existing?.seller || accountId;
              const dedupKey = `${getBaseOrderId(subId)}|${Number(ki)}|${seller}`;
              if (!existing && bidDedupIndex.has(dedupKey)) continue;

              const isoTime = new Date(tsMs).toISOString();
              const record: SaleRecord = {
                orderId:  subId,
                kamiId:   Number(ki),
                price,
                seller,
                buyer,
                type:     "bid",
                time:     isoTime,
                tradeTime: existing?.tradeTime ?? isoTime,
                rawTime:  existing?.rawTime ?? String(order.Timestamp),
              };
              newRecords.push(record);
              if (isNew) {
                bidDedupIndex.add(dedupKey);
                newForAccount++;
                totalNewSales++;
              }
            }
            continue;
          }

          // Skip fully-completed ANY bids already captured per-kami as partial fills
          if (order.Bid?.BidType === 1 && (order.Bid.BoughtKamiIndexes?.length ?? 0) > 0) continue;

          const kamiId = Number(order.Listing?.KamiIndex ?? order.Bid?.KamiIndex ?? 0);
          const price  = Number(BigInt(order.Listing?.Price ?? order.Bid?.Price ?? "0")) / 1e18;
          const seller = order.Listing?.SellerAccountID ?? (order.Bid ? accountId : "");
          const buyer  = order.Listing?.BuyerAccountID ?? order.Bid?.BuyerAccountID ?? "";
          const type   = order.Listing ? "listing" : "bid";

          const existing = existingHistoryMap.get(order.OrderID);
          const isNew    = !existing;

          const isoTime = new Date(tsMs).toISOString();
          const record: SaleRecord = {
            orderId: order.OrderID,
            kamiId,
            price,
            seller,
            buyer,
            type,
            time:      isoTime,
            tradeTime: existing?.tradeTime ?? isoTime,
            rawTime:   existing?.rawTime ?? String(order.Timestamp),
          };

          newRecords.push(record);
          if (isNew) { newForAccount++; totalNewSales++; }
        }

        const label = account.name ?? accountId;
        console.log(`   [${i + 1}/${batch.length}] ${label} → ${newForAccount} new trade(s) | backfill total: ${totalNewSales}`);
      }
    } catch (err) {
      console.error(`   [${i + 1}/${batch.length}] ❌ Failed for ${accountId}:`, (err as any)?.message);
    }

    if (i < batch.length - 1) await sleep(INTER_REQUEST_DELAY_MS);
  }

  return { newRecords, totalNewSales };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  try {
    console.log("=".repeat(60));
    console.log("🛒 Kamigotchi Listings + History Fetch (Combined)");
    console.log("=".repeat(60));

    // Start Feed stream immediately — deadline = 4.5 min
    const RUN_DEADLINE_MS = Date.now() + 4 * 60 * 1000;
    const feedTradesPromise = fetchFeedTrades(RUN_DEADLINE_MS);

    // --------------------------------------------------------
    // Load all R2 state + backfill setup in parallel
    // --------------------------------------------------------
    const [
      rawListings,
      { listings: prevListings, listingNewWindow: prevWindow },
      { history: prevHistory },
      cursor,
      bundle,
    ] = await Promise.all([
      fetchAllListings(),
      fetchPreviousListings(),
      fetchPreviousHistory(),
      fetchFromR2<Cursor>(CURSOR_KEY, { nextIndex: 0, total: 0 }),
      fetchFromR2<{ kamiAccounts?: Record<string, KamiAccount> }>("kamiBundle.json", {}),
    ]);

    // --------------------------------------------------------
    // BACKFILL BATCH SETUP (from fetch-history-backfill-gha.ts)
    // --------------------------------------------------------
    const accounts          = bundle.kamiAccounts ?? {};
    const allAccountEntries = Object.values(accounts).filter(a => a.id);
    const totalAccounts     = allAccountEntries.length;

    console.log(`\n📍 Backfill cursor: nextIndex=${cursor.nextIndex}, total=${cursor.total}`);
    console.log(`✅ Found ${totalAccounts} accounts with entity IDs`);

    const startIndex = cursor.nextIndex;
    const endIndex   = Math.min(startIndex + BATCH_SIZE, totalAccounts);
    const batch      = allAccountEntries.slice(startIndex, endIndex);

    console.log(`\n🔢 Backfill: accounts ${startIndex + 1}–${endIndex} of ${totalAccounts} (${batch.length} accounts)`);

    // Seed historyMap from existing R2 data
    // Seed historyMap from existing R2 data (all-time, no cutoff)
    const historyMap = new Map<string, SaleRecord>();
    for (const record of prevHistory) {
      historyMap.set(record.orderId, record);
    }

    // Index for bid dedup: "baseOrderId|kamiId|seller" -> true
    // baseOrderId strips the trailing "-{kamiId}-{timestamp}" suffix added to partial-fill bids
    function getBaseOrderId(orderId: string): string {
      // subIds have the form  "{realOrderId}-{kamiIndex}-{timestamp}"
      // Strip the last two dash-separated numeric segments when present
      return orderId.replace(/-\d+-\d+$/, "");
    }
    const bidDedupIndex = new Set<string>();
    for (const record of prevHistory) {
      if (record.type === "bid") {
        const key = `${getBaseOrderId(record.orderId)}|${record.kamiId}|${record.seller}`;
        bidDedupIndex.add(key);
      }
    }

    // --------------------------------------------------------
    // Run backfill batch concurrently with feed stream
    // --------------------------------------------------------
    const [feedTrades, { newRecords: backfillRecords, totalNewSales }] = await Promise.all([
      feedTradesPromise,
      fetchBackfillBatch(batch, historyMap, bidDedupIndex, getBaseOrderId),
    ]);

    // --------------------------------------------------------
    // Merge: backfill first, then feed (feed wins on conflict — has tradeTime)
    // Never overwrite rawTime or tradeTime of an already-stored record.
    // Skip bid records that share the same base orderId + kamiId + seller as an existing one.
    // --------------------------------------------------------
    for (const record of backfillRecords) {
      if (record.type === "bid") {
        const key = `${getBaseOrderId(record.orderId)}|${record.kamiId}|${record.seller}`;
        if (bidDedupIndex.has(key)) continue;
        bidDedupIndex.add(key);
      }
      const existing = historyMap.get(record.orderId);
      if (existing) {
        historyMap.set(record.orderId, {
          ...existing,
          ...record,
          rawTime:   existing.rawTime,
          tradeTime: existing.tradeTime,
        });
      } else {
        historyMap.set(record.orderId, record);
      }
    }
    for (const record of feedTrades) {
      if (record.type === "bid") {
        const key = `${getBaseOrderId(record.orderId)}|${record.kamiId}|${record.seller}`;
        if (bidDedupIndex.has(key)) continue;
        bidDedupIndex.add(key);
      }
      const existing = historyMap.get(record.orderId);
      if (existing) {
        historyMap.set(record.orderId, {
          ...existing,
          ...record,
          rawTime:   existing.rawTime,
          tradeTime: existing.tradeTime,
        });
      } else {
        historyMap.set(record.orderId, record);
      }
    }

    const mergedHistory = Array.from(historyMap.values())
      .sort((a, b) => Number(b.rawTime) - Number(a.rawTime));

    console.log(`\n📊 History: ${prevHistory.length} previous + ${backfillRecords.length} backfill (${totalNewSales} new) + ${feedTrades.length} feed → ${mergedHistory.length} total`);

    // Detect new trades for meta hash
    const prevOrderIds  = new Set(prevHistory.map(r => r.orderId));
    const newRecordsAll = mergedHistory.filter(r => !prevOrderIds.has(r.orderId));
    if (newRecordsAll.length > 0) {
      const kamiIds = [...new Set(newRecordsAll.map(r => r.kamiId))].sort((a, b) => a - b);
      console.log(`\n✨ Found ${newRecordsAll.length} new trade(s) for: ${kamiIds.join(', ')}`);
    }

    await uploadToR2(HISTORY_KEY, { history: mergedHistory });

    // --------------------------------------------------------
    // Update backfill cursor (from fetch-history-backfill-gha.ts)
    // --------------------------------------------------------
    const newNextIndex = endIndex >= totalAccounts ? 0 : endIndex;
    const newCursor: Cursor = { nextIndex: newNextIndex, total: totalAccounts };
    if (newNextIndex === 0) {
      newCursor.completedAt = new Date().toISOString();
      console.log(`\n✅ All ${totalAccounts} accounts processed — cursor reset to 0`);
    }
    await uploadToR2(CURSOR_KEY, newCursor);
    console.log(`💾 Cursor updated: nextIndex=${newCursor.nextIndex}`);

    // --------------------------------------------------------
    // META — lightweight file for browser polling
    // --------------------------------------------------------
    // totalCount is sufficient — any new record (feed or backfill) increments it
    await uploadToR2(META_KEY, {
      lastUpdated: new Date().toISOString(),
      totalCount:  mergedHistory.length,
    });

    // --------------------------------------------------------
    // LISTINGS PROCESSING (from fetch-listings-gha.ts, unchanged)
    // --------------------------------------------------------
    const NEW_WINDOW_RUNS = 13;

    if (rawListings.length > 0) {
      const byId: Record<string, SimpleListing> = {};
      rawListings.forEach((listing) => {
        const ts = Number(listing.Timestamp);
        const date = new Date(ts < 10_000_000_000 ? ts * 1000 : ts);
        byId[listing.KamiIndex] = {
          id:      Number(listing.KamiIndex),
          price:   Number(BigInt(listing.Price)) / 1e18,
          time:    date.toISOString(),
          rawTime: listing.Timestamp,
        };
      });

      const prevIdTimeMap = new Map(Object.values(prevListings).map(l => [String(l.id), l.rawTime]));
      const newListingId = Object.keys(byId).filter(id => {
        const prevTime = prevIdTimeMap.get(id);
        return prevTime === undefined || String(prevTime) !== String(byId[id].rawTime);
      });

      const listingNewWindow: Record<string, number> = {};
      for (const [id, remaining] of Object.entries(prevWindow)) {
        const next = remaining - 1;
        if (next > 0 && id in byId) listingNewWindow[id] = next;
      }
      for (const id of newListingId) {
        listingNewWindow[id] = NEW_WINDOW_RUNS;
      }

      if (newListingId.length > 0) {
        console.log(`\n✨ Found ${newListingId.length} new listing(s): ${newListingId.join(", ")}`);
      }
      console.log(`⏱️  IDs in listing-window: ${Object.keys(listingNewWindow).length > 0 ? Object.keys(listingNewWindow).join(", ") : "none"}`);

      const sortedEntries = Object.values(byId).sort((a, b) => a.id - b.id);
      const listings: Record<number, SimpleListing> = {};
      sortedEntries.forEach((item, i) => { listings[i + 1] = item; });

      console.log(`\nSuccessfully fetched ${sortedEntries.length} listings:`);
      

      await uploadToR2("kamiListings.json", { listings, newListingId, listingNewWindow });

    } else {
      console.log("No active listings found.");
      await uploadToR2("kamiListings.json", { listings: {}, newListingId: [], listingNewWindow: {} });
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Combined fetch & upload complete");
    console.log("=".repeat(60));

  } catch (err) {
    if (err instanceof Error) {
      console.error("Critical failure:", err.message);
    }
    process.exit(1);
  }
}

main();