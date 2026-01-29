// extract-kamigotchi-github.js
// GitHub Actions compatible version with Cloudflare R2 upload
// This script runs automatically every 2 hours

const { chromium } = require('playwright');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs').promises;

const BASE_STATS = {
  harmony: 10,
  health: 50,
  power: 10,
  violence: 10
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

/**
 * Calculate full stats for all Kamigotchi
 */
async function calculateKamiStats(traitsData) {
  console.log('\n📊 Calculating Kamigotchi stats...');
  
  const kamiStats = {};
  const statRankings = {
    harmony: [],
    health: [],
    power: [],
    violence: []
  };
  
  Object.entries(traitsData).forEach(([kamiId, traits]) => {
    const stats = {
      harmony: BASE_STATS.harmony,
      health: BASE_STATS.health,
      power: BASE_STATS.power,
      violence: BASE_STATS.violence
    };
    
    const traitBonuses = {
      harmony: [],
      health: [],
      power: [],
      violence: []
    };
    
    Object.entries(traits).forEach(([traitType, traitData]) => {
      if (traitData.stats) {
        Object.entries(traitData.stats).forEach(([statName, value]) => {
          if (stats.hasOwnProperty(statName)) {
            stats[statName] += value;
            traitBonuses[statName].push({
              trait: traitType,
              name: traitData.name,
              bonus: value
            });
          }
        });
      }
    });
    
    kamiStats[kamiId] = {
      id: parseInt(kamiId),
      stats: stats,
      bonuses: traitBonuses
    };
    
    statRankings.harmony.push({ id: kamiId, value: stats.harmony });
    statRankings.health.push({ id: kamiId, value: stats.health });
    statRankings.power.push({ id: kamiId, value: stats.power });
    statRankings.violence.push({ id: kamiId, value: stats.violence });
  });
  
  Object.keys(statRankings).forEach(statType => {
    statRankings[statType].sort((a, b) => b.value - a.value);
  });
  
  console.log(`   Total Kamigotchi: ${Object.keys(kamiStats).length}`);
  if (statRankings.harmony.length > 0) {
    console.log(`   Top Harmony: ${statRankings.harmony[0].value} (Kami #${statRankings.harmony[0].id})`);
    console.log(`   Top Health: ${statRankings.health[0].value} (Kami #${statRankings.health[0].id})`);
    console.log(`   Top Power: ${statRankings.power[0].value} (Kami #${statRankings.power[0].id})`);
    console.log(`   Top Violence: ${statRankings.violence[0].value} (Kami #${statRankings.violence[0].id})`);
  }
  
  return { kamiStats, statRankings };
}

/**
 * Upload file to Cloudflare R2
 */
async function uploadToR2(filename, data) {
  console.log(`📤 Uploading ${filename} to Cloudflare R2...`);
  
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: filename,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
    CacheControl: 'public, max-age=300', // 5 minutes cache
  });
  
  try {
    await r2Client.send(command);
    console.log(`   ✅ ${filename} uploaded successfully`);
  } catch (error) {
    throw new Error(`Upload failed for ${filename}: ${error.message}`);
  }
}

/**
 * Fetch previous metadata from Cloudflare R2
 */
async function fetchPreviousMetadata() {
  try {
    console.log('📋 Fetching previous metadata from R2...');
    
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: 'kamiMetadata.json',
    });
    
    const response = await r2Client.send(command);
    const body = await response.Body.transformToString();
    const metadata = JSON.parse(body);
    
    console.log(`   ✅ Found previous metadata (max ID: ${metadata.previousMaxId})`);
    return metadata;
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      console.log('   ℹ️  No previous metadata found (first run)');
    } else {
      console.log(`   ⚠️  Error fetching metadata: ${error.message}`);
    }
    
    return {
      previousMaxId: null,
      isFirstRun: true
    };
  }
}

/**
 * Main extraction function
 */
async function runExtraction() {
  let browser;
  const startTime = Date.now();
  
  try {
    console.log('='.repeat(60));
    console.log('🚀 Kamigotchi Data Extraction - GitHub Actions');
    console.log('='.repeat(60));
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log(`Repository: https://github.com/h80h/a_lil_kami`);
    console.log(`Storage: Cloudflare R2`);
    console.log('='.repeat(60));
    
    // Launch Playwright browser
    console.log('\n🌐 Launching browser...');
    browser = await chromium.launch({
      headless: true
    });
    
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      bypassCSP: true
    });
    
    // Disable cache for fresh data
    await context.route('**/*', (route) => {
      route.continue({
        headers: {
          ...route.request().headers(),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    });
    
    const page = await context.newPage();
    
    console.log('📄 Loading page...');
    await page.goto('https://app.kamigotchi.io', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    console.log('⏳ Waiting for page to stabilize...');
    await page.waitForTimeout(5000);
    
    console.log('⏳ Waiting for network object...');
    await page.waitForFunction(() => {
      return typeof window.network !== 'undefined' && 
             window.network?.explorer?.kamis?.all;
    }, { timeout: 120000 });
    
    console.log('⏳ Waiting for data to load...');
    console.log('📊 Loading Kamigotchi data (this may take 2-3 minutes for large datasets)...');
    
    // Wait for data with stability checks - optimized for 15000+ items
    let dataLoaded = false;
    let retries = 10; // 10 attempts * 60 seconds = 10 minutes max
    let previousCount = 0;
    let stableCount = 0;
    const targetStableChecks = 1;
    
    while (retries > 0 && !dataLoaded) {
      const testResult = await page.evaluate(() => {
        try {
          const allKami = network.explorer.kamis.all({stats: true});
          return {
            success: true,
            count: allKami?.length || 0,
            maxId: allKami?.length > 0 ? Math.max(...allKami.map(k => k.index)) : 0
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
            count: 0,
            maxId: 0
          };
        }
      });
      
      if (testResult.success && testResult.count > 0) {
        const percentOfMax = ((testResult.count / 22222) * 100).toFixed(1);
        console.log(`   📈 Progress: ${testResult.count} Kamigotchi loaded (${percentOfMax}% of max 22,222) | Max ID: ${testResult.maxId}`);
        
        // Check if count is stable
        if (testResult.count === previousCount) {
          stableCount++;
          console.log(`   ⏸️  Count stable (${stableCount}/${targetStableChecks} checks)`);
          
          if (stableCount >= targetStableChecks) {
            console.log(`\n✅ Data fully loaded and stable!`);
            console.log(`   Total: ${testResult.count} Kamigotchi`);
            console.log(`   Max ID: ${testResult.maxId}`);
            dataLoaded = true;
            break;
          }
        } else {
          const increase = testResult.count - previousCount;
          stableCount = 0;
          previousCount = testResult.count;
          console.log(`   🔄 Loading... (+${increase} new)`);
        }
      }
      
      retries--;
      if (retries > 0 && !dataLoaded) {
        console.log(`   ⏳ Waiting 60 seconds for more data... (${retries} attempts left)\n`);
        await page.waitForTimeout(60000);
      }
    }
    
    if (!dataLoaded) {
      throw new Error('Failed to load Kamigotchi data after multiple attempts');
    }
    
    console.log('\n📊 Extracting data from browser console...');
    
    // Extract images
    const imageMap = await page.evaluate(() => {
      return network.explorer.kamis.all({stats: true}).reduce((accumulator, currentObject) => {
        accumulator[currentObject.index] = currentObject.image;
        return accumulator;
      }, {});
    });
    
    // Extract enhanced traits with stats and affinity
    const traitsMap = await page.evaluate(() => {
      function extractDetailedTraits(kamiData) {
        const traitsToKeep = ["background", "body", "color", "face", "hand"];
        const detailedData = {};

        for (const kamiId in kamiData) {
          if (kamiData.hasOwnProperty(kamiId)) {
            const kamiEntry = kamiData[kamiId];
            const detailedEntry = {};

            traitsToKeep.forEach(traitKey => {
              if (kamiEntry.hasOwnProperty(traitKey)) {
                const trait = kamiEntry[traitKey];
                
                detailedEntry[traitKey] = {
                  name: trait.name
                };
                
                if ((traitKey === 'body' || traitKey === 'hand') && trait.affinity) {
                  detailedEntry[traitKey].affinity = trait.affinity;
                }
                
                if (trait.stats) {
                  const stats = {};
                  const statsToTrack = ['harmony', 'health', 'power', 'violence'];
                  
                  statsToTrack.forEach(statName => {
                    if (trait.stats[statName] && trait.stats[statName].base !== 0) {
                      stats[statName] = trait.stats[statName].base;
                    }
                  });
                  
                  if (Object.keys(stats).length > 0) {
                    detailedEntry[traitKey].stats = stats;
                  }
                }
              }
            });

            detailedData[kamiId] = detailedEntry;
          }
        }

        return detailedData;
      }

      const traitsMapRaw = network.explorer.kamis.all({traits: true}).reduce((accumulator, currentObject) => {
        accumulator[currentObject.index] = currentObject.traits;
        return accumulator;
      }, {});

      return extractDetailedTraits(traitsMapRaw);
    });
    
    await browser.close();
    browser = null;
    
    const imageCount = Object.keys(imageMap).length;
    const traitsCount = Object.keys(traitsMap).length;
    
    console.log(`✅ Extracted ${imageCount} images and ${traitsCount} enhanced traits`);
    
    // Calculate stats
    const { kamiStats, statRankings } = await calculateKamiStats(traitsMap);
    
    // Get previous metadata
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
    
    // Prepare metadata
    const metadata = {
      lastUpdate: new Date().toISOString(),
      previousMaxId: currentMaxId,
      newKamiIds: newKamiIds.sort((a, b) => a - b),
      totalCount: allIds.length,
      extractedBy: 'GitHub Actions',
      extractionDuration: Math.round((Date.now() - startTime) / 1000),
      storageProvider: 'Cloudflare R2'
    };
    
    // Upload all files to Cloudflare R2
    console.log('\n📤 Uploading to Cloudflare R2...');
    
    await uploadToR2('kamiImage.json', imageMap);
    await uploadToR2('kamiTraits.json', traitsMap);
    await uploadToR2('kamiStats.json', kamiStats);
    await uploadToR2('kamiRankings.json', statRankings);
    await uploadToR2('kamiMetadata.json', metadata);
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    // Create log summary
    const logContent = `
Kamigotchi Data Extraction Log
${'='.repeat(60)}
Timestamp: ${new Date().toISOString()}
Duration: ${duration} seconds
Storage: Cloudflare R2
${'='.repeat(60)}

RESULTS:
- Total Kamigotchi: ${allIds.length}
- New Kamigotchi: ${newKamiIds.length}
- Previous max ID: ${previousMetadata.previousMaxId || 'none (first run)'}
- Current max ID: ${currentMaxId}
- New IDs: ${newKamiIds.join(', ') || 'none'}

FILES UPLOADED TO R2:
✅ kamiImage.json (${imageCount} entries)
✅ kamiTraits.json (${traitsCount} entries with stats)
✅ kamiStats.json (${Object.keys(kamiStats).length} calculated stats)
✅ kamiRankings.json (4 stat rankings)
✅ kamiMetadata.json (tracking metadata)

${'='.repeat(60)}
Extraction completed successfully! 🎉
    `.trim();
    
    await fs.writeFile('extraction.log', logContent, 'utf8');
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ EXTRACTION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Duration: ${duration} seconds`);
    console.log(`Total Kamigotchi: ${allIds.length}`);
    console.log(`New Kamigotchi: ${newKamiIds.length}`);
    console.log(`Storage: Cloudflare R2`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ EXTRACTION FAILED');
    console.error('='.repeat(60));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('='.repeat(60));
    
    if (browser) {
      await browser.close();
    }
    
    // Create error log
    const errorLog = `
Kamigotchi Data Extraction - ERROR
${'='.repeat(60)}
Timestamp: ${new Date().toISOString()}
${'='.repeat(60)}

ERROR DETAILS:
${error.message}

STACK TRACE:
${error.stack}

${'='.repeat(60)}
    `.trim();
    
    await fs.writeFile('extraction.log', errorLog, 'utf8');
    
    process.exit(1);
  }
}

// Run the extraction
runExtraction();