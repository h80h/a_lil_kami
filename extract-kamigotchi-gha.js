const { chromium } = require('playwright');
const { S3Client, GetObjectCommand, CopyObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require("@aws-sdk/lib-storage");
const { Readable } = require('stream');


// Initialize Cloudflare R2 client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// ─── VERSIONING HELPER ────────────────────────────────────────────────────────
const MAX_VERSIONS = 3;

async function versionFile(key) {
  try {
    // 1. Check the file exists before trying to version it
    await r2Client.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    }));
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      console.log(`   ⏭️  No existing ${key} to version (first run)`);
      return;
    }
    console.warn(`   ⚠️  Could not check ${key} before versioning: ${err.message}`);
    return;
  }

  try {
    // 2. Copy current file to versions/<key>/<timestamp>
    const timestamp = new Date().toISOString();
    const versionKey = `versions/${key}/${timestamp}`;

    await r2Client.send(new CopyObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CopySource: `${process.env.R2_BUCKET_NAME}/${key}`,
      Key: versionKey,
    }));
    console.log(`   🗂️  Versioned ${key} → ${versionKey}`);

    // 3. Prune oldest versions if we exceed MAX_VERSIONS
    const listed = await r2Client.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: `versions/${key}/`,
    }));

    const versions = listed.Contents || [];
    if (versions.length > MAX_VERSIONS) {
      versions.sort((a, b) => a.Key.localeCompare(b.Key)); // oldest first
      const toDelete = versions.slice(0, versions.length - MAX_VERSIONS);
      for (const v of toDelete) {
        await r2Client.send(new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: v.Key,
        }));
        console.log(`   🗑️  Pruned old version: ${v.Key}`);
      }
    }
  } catch (err) {
    // Versioning failure should never block the main upload
    console.warn(`   ⚠️  Versioning failed for ${key}: ${err.message}`);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

async function uploadBundleToR2(bundleData) {
  const filename = 'kamiBundle.json';
  console.log(`\n📤 Uploading ${filename} to Cloudflare R2 via Managed Streaming...`);

  const stream = Readable.from(JSON.stringify(bundleData));

  try {
    const parallelUploads3 = new Upload({
      client: r2Client,
      params: {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: filename,
        Body: stream,
        ContentType: 'application/json',
        CacheControl: 'public, max-age=300',
      },
      queueSize: 4,
      partSize: 1024 * 1024 * 15,
    });

    parallelUploads3.on("httpUploadProgress", (progress) => {
      if (progress.loaded % (1024 * 1024 * 100) < (1024 * 1024 * 15)) {
        console.log(`   Progress: ${Math.round((progress.loaded / 1024 / 1024))}MB uploaded`);
      }
    });

    await parallelUploads3.done();
    console.log(`   ✅ ${filename} uploaded successfully`);
  } catch (error) {
    throw new Error(`Multipart Upload failed: ${error.message}`);
  }
}

async function uploadMetaToR2(metaData) {
  const filename = 'kamiMeta.json';
  console.log(`\n📤 Uploading ${filename} to Cloudflare R2...`);
  await versionFile(filename);
  try {
    const parallelUploads3 = new Upload({
      client: r2Client,
      params: {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: filename,
        Body: Readable.from(JSON.stringify(metaData)),
        ContentType: 'application/json',
        CacheControl: 'public, max-age=300',
      },
      queueSize: 1,
      partSize: 1024 * 1024 * 5,
    });
    await parallelUploads3.done();
    console.log(`   ✅ ${filename} uploaded successfully`);
  } catch (error) {
    throw new Error(`Meta upload failed: ${error.message}`);
  }
}

async function fetchPreviousMetadata() {
  console.log('📋 Fetching previous metadata from R2 bundle...');
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: 'kamiBundle.json',
    });
    const response = await r2Client.send(command);
    const body = await response.Body.transformToString();
    const bundle = JSON.parse(body);
    return bundle.kamiMetadata || { previousMaxId: null, isFirstRun: true, kamiNewWindow: {} };
  } catch (error) {
    // Genuine first run (bucket empty) — safe to continue with defaults
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      console.log('   ⏭️  No existing kamiBundle.json found — treating as first run');
      return { previousMaxId: null, isFirstRun: true, kamiNewWindow: {} };
    }
    // Any other R2 error (network flake, auth, etc.) — abort to protect existing data
    throw new Error(`R2 read failed for kamiBundle.json: ${error.message}`);
  }
}

async function runExtraction() {
  let browser;
  const startTime = Date.now();

  try {
    console.log('='.repeat(60));
    console.log('🚀 Kamigotchi Data Extraction - Restore Logic Version');
    console.log('='.repeat(60));

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
    const page = await context.newPage();

    await page.goto('https://app.kamigotchi.io', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    await page.waitForFunction(() => typeof window.network !== 'undefined' && window.network?.explorer?.kamis?.all, { timeout: 120000 });

    let dataLoaded = false;
    let retries = 15;
    let previousCount = 0;

    while (retries > 0 && !dataLoaded) {
      const testResult = await page.evaluate(() => {
        const allKami = network.explorer.kamis.all({stats: true});
        return { count: allKami?.length || 0, maxId: allKami?.length > 0 ? Math.max(...allKami.map(k => k.index)) : 0 };
      });
      console.log(`   📈 Progress: ${testResult.count} items | Max ID: ${testResult.maxId}`);
      if (testResult.count > 0 && testResult.count === previousCount) { dataLoaded = true; break; }
      previousCount = testResult.count;
      retries--;
      if (!dataLoaded) await page.waitForTimeout(30000);
    }

    if (!dataLoaded || previousCount === 0) {
      throw new Error(`Data load failed: received 0 items after all retries. The site may be down or the network API did not load.`);
    }

    const { imageMap, traitsMap, traitIndexMap, kamiInfoMap, kamiAccountsMap, prices } = await page.evaluate(() => {
      function extractSlimTraits(kamiData) {
        // kamiTraits: each kami maps trait slot → trait name string only
        // affinity stays on body/hand for the filter UI to use via kamiTraitIndex lookup
        const traitsToKeep = ["background", "body", "color", "face", "hand"];
        const detailedData = {};
        for (const kamiId in kamiData) {
          const kamiEntry = kamiData[kamiId];
          const detailedEntry = {};
          traitsToKeep.forEach(traitKey => {
            if (kamiEntry[traitKey]) {
              detailedEntry[traitKey] = kamiEntry[traitKey].name;
            }
          });
          detailedData[kamiId] = detailedEntry;
        }
        return detailedData;
      }

      // Single combined pass: traits + stats + progress (merged, no repeated calls)
      const allFull = network.explorer.kamis.all({ traits: true, stats: true, progress: true });

      const img      = {};
      const trtRaw   = {};
      const kamiInfo = {};

      // stats array order: [harmony, health, power, violence]
      const STAT_KEYS = ['health', 'power', 'violence', 'harmony'];

      allFull.forEach(k => {
        img[k.index]    = k.image;
        trtRaw[k.index] = k.traits;

        // kamiInfo entry: name, level (k.progress.level), stats as compact array [harmony, health, power, violence]
        kamiInfo[k.index] = {
          name:  k.name            ?? null,
          level: k.progress?.level ?? null,
          stats: k.stats ? STAT_KEYS.map(s => k.stats[s]?.total ?? null) : null,
        };
      });

      // Trait index: entity id → { name, rarity, affinity?, stats: {only nonzero base values} }
      // Keyed by entity id so script.js can look up stats/affinity by trait name via a name→entity reverse map
      const allTraitEntities = network.explorer.traits.all();
      const traitIndex = {};
      allTraitEntities.forEach((t, i) => {
        const entry = { name: t.name, rarity: t.rarity };
        if (t.affinity) entry.affinity = t.affinity;
        if (t.stats) {
          const stats = {};
          ['harmony', 'health', 'power', 'violence', 'slots'].forEach(s => {
            if (t.stats[s] && t.stats[s].base !== 0) stats[s] = t.stats[s].base;
          });
          if (Object.keys(stats).length > 0) entry.stats = stats;
        }
        traitIndex[i + 1] = entry;
      });

      // Accounts: name and list of their kami indices
      // { kamis: true } returns full KAMI objects; we extract only the index
      const allAccounts = network.explorer.accounts.all({ kamis: true });
      const accounts    = {};
      allAccounts.forEach(acc => {
        accounts[acc.index] = {
          name:   acc.name   ?? null,
          id:    acc.id ? BigInt(acc.id).toString() : null,
          kamis:  Array.isArray(acc.kamis) ? acc.kamis.map(k => k.index) : [],
        };
      });

      const prices = (() => {
        try {
          const raw = network.explorer.auctions.getPrices();
          const gacha  = raw.find(p => p.name === 'Gacha Ticket');
          const reroll = raw.find(p => p.name === 'Reroll Ticket');
          return {
            mintPrice:   gacha?.price  ?? null,
            rerollPrice: reroll?.price ?? null,
          };
        } catch { return { mintPrice: null, rerollPrice: null }; }
      })();

      return {
        imageMap:        img,
        traitsMap:       extractSlimTraits(trtRaw),
        traitIndexMap:   traitIndex,
        kamiInfoMap:     kamiInfo,
        kamiAccountsMap: accounts,
        prices,
      };
    });

    await browser.close();

    // Check for new Kamigotchi
    console.log('\n📋 Checking for new Kamigotchi...');
    const previousMetadata = await fetchPreviousMetadata();
    const isFirstRun = previousMetadata.previousMaxId === null;

    const allIds = Object.keys(imageMap).map(Number);
    const currentMaxId = Math.max(...allIds);
    const newKamiIds = allIds.filter(id => id > (previousMetadata.previousMaxId || 0));
    const hasNewKami = newKamiIds.length > 0 || isFirstRun;

    if (isFirstRun) {
      console.log(`🆕 First run - establishing baseline (max ID: ${currentMaxId})`);
    } else if (hasNewKami) {
      console.log(`🆕 NEW Kamigotchi detected: ${newKamiIds.length}`);
      console.log(`   IDs: ${newKamiIds.sort((a, b) => a - b).join(', ')}`);
      console.log(`   Previous max: ${previousMetadata.previousMaxId} → Current max: ${currentMaxId}`);
    } else {
      console.log(`💤 No new Kamigotchi (still at max ID: ${currentMaxId})`);
    }

    // New-window tracking: each newly discovered ID enters kamiNewWindow with 13 runs remaining.
    // Every run decrements all counters; IDs reaching 0 are removed (~1 hour at 5-min intervals).
    const NEW_WINDOW_RUNS = 13;
    const prevWindow = previousMetadata.kamiNewWindow || {};

    const updatedWindow = {};
    for (const [id, remaining] of Object.entries(prevWindow)) {
      const next = remaining - 1;
      if (next > 0) updatedWindow[id] = next;
    }

    // Skip on first run — everything would be "new" otherwise
    if (!isFirstRun) {
      for (const id of newKamiIds) {
        updatedWindow[id] = NEW_WINDOW_RUNS;
      }
    }

    console.log(`⏱️  IDs in new-window: ${Object.keys(updatedWindow).length > 0 ? Object.keys(updatedWindow).join(', ') : 'none'}`);

    const bundle = {
      kamiImage: imageMap,
      kamiTraits: traitsMap,
      kamiTraitIndex: traitIndexMap,
      kamiInfo: kamiInfoMap,
      kamiAccounts: kamiAccountsMap,
      kamiMetadata: {
        lastUpdate: new Date().toISOString(),
        previousMaxId: currentMaxId,
        newKamiIds: newKamiIds.sort((a, b) => a - b),
        kamiNewWindow: updatedWindow,
        totalCount: allIds.length,
        extractionDuration: Math.round((Date.now() - startTime) / 1000),
        mintPrice:   prices.mintPrice,
        rerollPrice: prices.rerollPrice,
      }
    };

    const slimMeta = {
      lastUpdate:    bundle.kamiMetadata.lastUpdate,
      kamiNewWindow: bundle.kamiMetadata.kamiNewWindow,
      totalCount:    bundle.kamiMetadata.totalCount,
      kamiAccounts:  kamiAccountsMap,
    };

    // ─── SANITY GUARD ─────────────────────────────────────────────────────────
    // If we fetched significantly fewer Kamis than last time, something went wrong
    // during extraction (site flake, early exit, etc.). Abort to protect R2 data.
    if (!isFirstRun && previousMetadata.totalCount) {
      const DROP_THRESHOLD = 0.9; // allow up to 10% drop (e.g. kami burned/removed)
      if (allIds.length < previousMetadata.totalCount * DROP_THRESHOLD) {
        throw new Error(
          `Safety abort: extracted ${allIds.length} items but previous run had ${previousMetadata.totalCount}. ` +
          `This looks like an incomplete extraction — refusing to overwrite R2 data.`
        );
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    await Promise.all([
      uploadBundleToR2(bundle),
      uploadMetaToR2(slimMeta),
    ]);

    console.log('\n' + '='.repeat(60));
    console.log(`✅ COMPLETE: ${bundle.kamiMetadata.totalCount} items | ${bundle.kamiMetadata.extractionDuration}s`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ FAILED:', error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

runExtraction();