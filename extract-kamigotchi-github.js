// extract-kamigotchi-github.js
// GitHub Actions compatible version with Vercel Blob upload
// This script runs automatically every 90 minutes

const { chromium } = require('playwright');
const fs = require('fs').promises;

const BASE_STATS = {
  harmony: 10,
  health: 50,
  power: 10,
  violence: 10
};

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
 * Upload file to Vercel Blob Storage using REST API with fixed pathname
 * Overwrites existing file if it already exists
 */
async function uploadToVercelBlob(filename, data) {
  const token = process.env.VERCEL_BLOB_TOKEN;
  
  if (!token) {
    throw new Error('❌ VERCEL_BLOB_TOKEN not set in environment variables');
  }
  
  console.log(`📤 Uploading ${filename}...`);
  
  // First, try to delete the old file if it exists
  try {
    const deleteUrl = `https://blob.vercel-storage.com/${filename}`;
    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (deleteResponse.ok) {
      console.log(`   🗑️  Deleted old ${filename}`);
    }
  } catch (error) {
    // File might not exist, that's okay
    console.log(`   ℹ️  No old ${filename} to delete (first upload)`);
  }
  
  // Now upload the new file
  const url = `https://blob.vercel-storage.com/${filename}`;
  
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0'  // This prevents random suffix!
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed for ${filename}: ${response.status} - ${errorText}`);
  }
  
  const result = await response.json();
  console.log(`   ✅ ${filename} uploaded successfully`);
  console.log(`   📍 URL: ${result.url}`);
  return result;
}

/**
 * Fetch previous metadata from Vercel Blob
 */
async function fetchPreviousMetadata() {
  try {
    const token = process.env.VERCEL_BLOB_TOKEN;
    const response = await fetch('https://5rlbyplg6mxh9kru.public.blob.vercel-storage.com/kamiMetadata.json', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.log('ℹ️  No previous metadata found (first run)');
  }
  
  return {
    previousMaxId: null,
    isFirstRun: true
  };
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
    }, { timeout: 60000 });
    
    console.log('⏳ Waiting for data to load...');
    
    // Wait for data with retries
    let dataLoaded = false;
    let retries = 6; // 6 attempts * 10 seconds = 1 minute max
    
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
        console.log(`✅ Data loaded! Found ${testResult.count} Kamigotchi (max ID: ${testResult.maxId})`);
        dataLoaded = true;
        break;
      }
      
      retries--;
      if (retries > 0) {
        console.log(`⏳ Waiting 30 seconds... (${retries} attempts left)`);
        await page.waitForTimeout(30000);
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
      extractionDuration: Math.round((Date.now() - startTime) / 1000)
    };
    
    // Upload all files to Vercel Blob
    console.log('\n📤 Uploading to Vercel Blob Storage...');
    
    await uploadToVercelBlob('kamiImage.json', imageMap);
    await uploadToVercelBlob('kamiTraits.json', traitsMap);
    await uploadToVercelBlob('kamiStats.json', kamiStats);
    await uploadToVercelBlob('kamiRankings.json', statRankings);
    await uploadToVercelBlob('kamiMetadata.json', metadata);
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    // Create log summary
    const logContent = `
Kamigotchi Data Extraction Log
${'='.repeat(60)}
Timestamp: ${new Date().toISOString()}
Duration: ${duration} seconds
${'='.repeat(60)}

RESULTS:
- Total Kamigotchi: ${allIds.length}
- New Kamigotchi: ${newKamiIds.length}
- Previous max ID: ${previousMetadata.previousMaxId || 'none (first run)'}
- Current max ID: ${currentMaxId}
- New IDs: ${newKamiIds.join(', ') || 'none'}

FILES UPLOADED:
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