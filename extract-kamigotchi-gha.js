const { chromium } = require('playwright');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require("@aws-sdk/lib-storage");
const { Readable } = require('stream');
const fs = require('fs').promises;

const BASE_STATS = {
  harmony: 10,
  health: 50,
  power: 10,
  violence: 10,
  slots: 0
};

// Initialize Cloudflare R2 client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function calculateKamiStats(traitsData) {
  console.log('\n📊 Calculating Kamigotchi stats...');
  const kamiStats = {};
  const statRankings = { harmony: [], health: [], power: [], violence: [], slots: [] };
  
  Object.entries(traitsData).forEach(([kamiId, traits]) => {
    const stats = { ...BASE_STATS };
    const traitBonuses = { harmony: [], health: [], power: [], violence: [], slots: [] };
    
    Object.entries(traits).forEach(([traitType, traitData]) => {
      if (traitData.stats) {
        Object.entries(traitData.stats).forEach(([statName, value]) => {
          if (stats.hasOwnProperty(statName)) {
            stats[statName] += value;
            traitBonuses[statName].push({ trait: traitType, name: traitData.name, bonus: value });
          }
        });
      }
    });
    
    kamiStats[kamiId] = { id: parseInt(kamiId), stats: stats, bonuses: traitBonuses };
    statRankings.harmony.push({ id: kamiId, value: stats.harmony });
    statRankings.health.push({ id: kamiId, value: stats.health });
    statRankings.power.push({ id: kamiId, value: stats.power });
    statRankings.violence.push({ id: kamiId, value: stats.violence });
    statRankings.slots.push({ id: kamiId, value: stats.slots });
  });
  
  Object.keys(statRankings).forEach(statType => statRankings[statType].sort((a, b) => b.value - a.value));
  
  console.log(`   Total Kamigotchi: ${Object.keys(kamiStats).length}`);
  return { kamiStats, statRankings };
}

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
  try {
    console.log('📋 Fetching previous metadata from R2 bundle...');
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: 'kamiBundle.json',
    });
    const response = await r2Client.send(command);
    const body = await response.Body.transformToString();
    const bundle = JSON.parse(body);
    return bundle.kamiMetadata || { previousMaxId: null, isFirstRun: true, kamiNewWindow: {} };
  } catch (error) {
    return { previousMaxId: null, isFirstRun: true, kamiNewWindow: {} };
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

    const { imageMap, traitsMap, listedSet } = await page.evaluate(() => {
      function extractDetailedTraits(kamiData) {
        const traitsToKeep = ["background", "body", "color", "face", "hand"];
        const detailedData = {};
        for (const kamiId in kamiData) {
          const kamiEntry = kamiData[kamiId];
          const detailedEntry = {};
          traitsToKeep.forEach(traitKey => {
            if (kamiEntry[traitKey]) {
              const trait = kamiEntry[traitKey];
              detailedEntry[traitKey] = { name: trait.name };
              if ((traitKey === 'body' || traitKey === 'hand') && trait.affinity) detailedEntry[traitKey].affinity = trait.affinity;
              if (trait.stats) {
                const stats = {};
                ['harmony', 'health', 'power', 'violence', 'slots'].forEach(s => {
                  if (trait.stats[s] && trait.stats[s].base !== 0) stats[s] = trait.stats[s].base;
                });
                if (Object.keys(stats).length > 0) detailedEntry[traitKey].stats = stats;
              }
            }
          });
          detailedData[kamiId] = detailedEntry;
        }
        return detailedData;
      }
      const all = network.explorer.kamis.all({traits: true, stats: true});
      const img = {};
      const trtRaw = {};
      const listed = new Set();
      all.forEach(k => {
        img[k.index] = k.image;
        trtRaw[k.index] = k.traits;
        if (k.state === 'LISTED') listed.add(k.index);
      });
      return { imageMap: img, traitsMap: extractDetailedTraits(trtRaw), listedSet: Array.from(listed) };
    });
    
    await browser.close();
    
    const { kamiStats, statRankings } = await calculateKamiStats(traitsMap);
    
    // --- RESTORED DETECTION LOGIC START ---
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
    // --- RESTORED DETECTION LOGIC END ---

    // --- NEW-WINDOW LOGIC START ---
    // Each newly discovered ID enters kamiNewWindow with 13 runs remaining (including this run).
    // Every run decrements all counters. IDs reaching 0 are removed (~1 hour at 5-min intervals).
    const NEW_WINDOW_RUNS = 13;
    const prevWindow = previousMetadata.kamiNewWindow || {};

    // Decrement existing entries, drop any that have expired
    const updatedWindow = {};
    for (const [id, remaining] of Object.entries(prevWindow)) {
      const next = remaining - 1;
      if (next > 0) updatedWindow[id] = next;
    }

    // Add brand-new IDs (skip on first run — everything would be "new" otherwise)
    if (!isFirstRun) {
      for (const id of newKamiIds) {
        updatedWindow[id] = NEW_WINDOW_RUNS;
      }
    }

    console.log(`⏱️  IDs in new-window: ${Object.keys(updatedWindow).length > 0 ? Object.keys(updatedWindow).join(', ') : 'none'}`);
    // --- NEW-WINDOW LOGIC END ---

    const bundle = {
      kamiImage: imageMap,
      kamiTraits: traitsMap,
      kamiStats: kamiStats,
      kamiRankings: statRankings,
      kamiListed: listedSet,
      kamiMetadata: {
        lastUpdate: new Date().toISOString(),
        previousMaxId: currentMaxId,
        newKamiIds: newKamiIds.sort((a, b) => a - b),   // IDs first seen THIS run
        kamiNewWindow: updatedWindow,                     // Persistent countdown map { id: remainingRuns }
        totalCount: allIds.length,
        extractionDuration: Math.round((Date.now() - startTime) / 1000)
      }
    };
    
    await Promise.all([
      uploadBundleToR2(bundle),
      uploadMetaToR2(bundle.kamiMetadata),
    ]);
    
    console.log('\n' + '='.repeat(60));
    console.log(`✅ COMPLETE: ${bundle.kamiMetadata.totalCount} items | ${listedSet.length} listed | ${bundle.kamiMetadata.extractionDuration}s`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ FAILED:', error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

runExtraction();