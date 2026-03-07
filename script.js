// "Bot Armor" state - tracks the last time we talked to the database
let lastRequestTime = 0;

/* === UMAMI HONEST TRACKER START === */
(function() {
  try {
    const config = {
      id: 'd7d7ed00-7944-425f-8a8c-552bf9916cc0',
      domains: 'kami.h80h.xyz',
      host: 'https://kami.h80h.xyz/stats',
      src: '/stats/script.js'
    };

    const tiers = { 
      'just-checking': 2000, 
      'interested': 10000, 
      'engaged': 30000, 
      'deep-dive': 120000,
      'dedicated': 300000,
      'long-engagement': 600000 
    };

    if (window.location.hostname === 'localhost' || navigator.webdriver) return;

    const el = document.createElement('script');
    Object.assign(el, { src: config.src, defer: true });
    el.setAttribute('data-website-id', config.id);
    el.setAttribute('data-domains', config.domains);
    el.setAttribute('data-host-url', config.host);
    el.setAttribute('data-auto-track', 'false');
    document.head.appendChild(el);

    // --- REFRESH-PROOF MEMORY ---
    const getSessionVal = (key) => parseInt(sessionStorage.getItem(key) || '0');
    const setSessionVal = (key, val) => sessionStorage.setItem(key, val.toString());

    let engagementInterval, pageViewSent = false, lastEventTime = 0;
    let totalActiveTime = getSessionVal('kami_active_ms');
    let heartbeatCount = getSessionVal('kami_hb_count');
    let lastInteractionTimestamp = 0; 
    const MAX_HEARTBEATS = 5;

    window.startHonestTracking = () => {
      if (engagementInterval) return;

      let lastUrl = window.location.href;
      const watchFilters = (force = false) => {
        if ((window.location.href !== lastUrl || force) && window.umami && pageViewSent) {
          lastUrl = window.location.href;
          const params = new URLSearchParams(window.location.search);
          const filterData = Object.fromEntries(params.entries());
          
          if (Object.keys(filterData).length > 0) {
            umami.track('filter-applied', filterData);
            lastInteractionTimestamp = Date.now(); 
          }
        }
      };
      
      window.addEventListener('popstate', () => watchFilters());
      const originalPush = history.pushState;
      history.pushState = function() {
        originalPush.apply(this, arguments);
        watchFilters();
      };

      document.addEventListener('visibilitychange', () => {
        if (window.umami && pageViewSent) {
          if (document.visibilityState === 'visible') {
            umami.track('tab-focus');
          } else {
            umami.track('app-hidden');
          }
        }
      });

      engagementInterval = setInterval(() => {
        const now = Date.now();
        const isGracePeriod = totalActiveTime < 600000;
        const hasRecentInteraction = (now - lastInteractionTimestamp) < 300000;

        if (document.visibilityState === 'visible' && (isGracePeriod || hasRecentInteraction)) {
          totalActiveTime += 1000;
          setSessionVal('kami_active_ms', totalActiveTime); // SAVE TO SESSION

          for (let [name, ms] of Object.entries(tiers)) {
            // Check if tier was already sent in this session via sessionStorage
            const tierKey = 'kami_tier_' + name;
            const alreadySent = sessionStorage.getItem(tierKey) === 'true';

            if (totalActiveTime >= ms && !alreadySent) {
              if (window.umami) {
                if (!pageViewSent) { 
                  umami.track(); 
                  pageViewSent = true; 
                  if (window.location.search) watchFilters(true); 
                }
                umami.track(name, { seconds: ms / 1000 });
                sessionStorage.setItem(tierKey, 'true'); // MARK AS SENT
                lastEventTime = totalActiveTime;
              }
            }
          }

          if (totalActiveTime >= 600000 && (totalActiveTime - lastEventTime >= 240000)) {
            if (window.umami && heartbeatCount < MAX_HEARTBEATS && hasRecentInteraction) {
              umami.track('heartbeat');
              heartbeatCount++;
              setSessionVal('kami_hb_count', heartbeatCount); // SAVE TO SESSION
              lastEventTime = totalActiveTime;
            }
          }
        }
      }, 1000);
    };
  } catch (e) {}
})();
/* === UMAMI HONEST TRACKER END === */

/* --- UI FUNCTIONS --- */
async function updateLiveStatus() {
  const now = Date.now();
  if (now - lastRequestTime < 10000) return; 
  lastRequestTime = now;

  try {
    // ADDED: ?t= timestamp to kill the 304 cache freeze
    const response = await fetch(`/api/heartbeat?t=${now}`); 
    if (!response.ok) throw new Error('Network error');
    
    const data = await response.json();
    
    // The Raw Truth for the console
    const rawCount = data.count || 0; 

    const countElement = document.getElementById('online-count');
    if (countElement) {
      // 1. UI FALLBACK: Show 1 if count is 0
      const displayCount = rawCount > 0 ? rawCount : 1;
      countElement.innerText = displayCount; 
      countElement.classList.add('visible');

      // 2. CONSOLE TRUTH
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const statusColor = rawCount > 0 ? "#22c55e" : "#999"; // Green for active, Red/Gray for 0
      
      console.log(
        `%c● %cLive Status %c[%s]%c %c${rawCount} Online %c(UI: ${displayCount})`,
        `color: ${statusColor}; font-size: 14px;`, 
        "color: #bbb; ", 
        "color: #666; font-family: monospace;", 
        time,
        "color: #bbb;", 
        `color: ${statusColor};`,
        "color: #555; font-size: 10px; font-style: italic;" 
      );
    }
  } catch (err) {
    console.error('%c[!] Live Sync Interrupted.', "color: #ef4444;");
  }
}

// Main Project

let imagesData = {};
let traitsData = {};
let kamiStatsData = {};
let affinityData = {}; // NEW: Store body and hand affinity for each NFT
let selectedIDs = new Set();
let allNFTIds = [];
let filteredNFTIds = [];
let currentLoadIndex = 0;
let traitCounts = {};
let nftRarityScores = {};
let sacrificedNFTs = new Set(); // NEW: Store IDs of sacrificed Kamigotchi
let listedNFTs = new Set(); // Store IDs of LISTED (for sale) Kamigotchi

let traitSignatures = {}; // Store trait signatures for clone detection

// Stat min/max filter state: { statName: { value, isMax } }
// isMax=false means ">= value" (min mode), isMax=true means "<= value" (MAX mode)
let statMinMaxFilters = {
    health:   { value: 50,  isMax: false },
    power:    { value: 10,  isMax: false },
    violence: { value: 10,  isMax: false },
    harmony:  { value: 10,  isMax: false },
    slots:    { value: 0,   isMax: false }
};

let currentSortOrder = 'latest'; // Default sort
let isFiltering = false;

let isShowingClonesOnly = false; // New flag for clone filter

// NEW: Track selected affinity filters
let selectedBodyAffinities = new Set();
let selectedHandAffinities = new Set();

let nftObserver = null;
const INITIAL_LOAD_COUNT = 50;
const LAZY_LOAD_COUNT = 30;
let isLoading = false;
let metadataInfo = {};
let isRefreshing = false;

// --- URL SYNCHRONIZATION FUNCTIONS ---

// MODIFIED: Exclude traits from the URL if they are already represented by an active Affinity
function getTraitStringFromState() {
    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    const selected = {};
    
    checkboxes.forEach(checkbox => {
        const type = checkbox.dataset.traitType;
        const value = checkbox.dataset.traitValue;

        let isCoveredByAffinity = false;
        if (type === 'body' || type === 'hand') {
            const affinitySet = type === 'body' ? selectedBodyAffinities : selectedHandAffinities;
            const traitData = Object.values(traitsData).find(nft => nft[type]?.name === value)?.[type];
            if (traitData && affinitySet.has(traitData.affinity)) {
                isCoveredByAffinity = true;
            }
        }

        if (!isCoveredByAffinity) {
            if (!selected[type]) selected[type] = [];
            selected[type].push(encodeURIComponent(value));
        }
    });

    return Object.entries(selected).map(([type, values]) => `${type}:${values.join(',')}`).join(';');
}

// NEW: Get affinity filter state as URL string
function getAffinityStringFromState() {
    const parts = [];
    if (selectedBodyAffinities.size > 0) {
        parts.push(`body:${Array.from(selectedBodyAffinities).join(',')}`);
    }
    if (selectedHandAffinities.size > 0) {
        parts.push(`hand:${Array.from(selectedHandAffinities).join(',')}`);
    }
    return parts.join(';');
}

function getMinMaxStringFromState() {
    const parts = [];
    Object.entries(statMinMaxFilters).forEach(([statName, filter]) => {
        if (!isStatFilterDefault(statName)) {
            parts.push(`${statName}:${filter.value}:${filter.isMax ? 'max' : 'min'}`);
        }
    });
    return parts.join(';');
}

// Updates the browser URL based on the current app state
function updateURL(replace = false) {
    const params = new URLSearchParams();

    // 1. Sort Order
    if (currentSortOrder && currentSortOrder !== 'latest') {
        params.set('sort', currentSortOrder);
    }

    // 2. Trait Filters
    const traitString = getTraitStringFromState();
    if (traitString) {
        params.set('traits', traitString);
    }

    // 3. Selected IDs (for comparison area)
    const idArray = Array.from(selectedIDs).sort((a, b) => Number(a) - Number(b));
    if (idArray.length > 0) {
        params.set('ids', idArray.join(','));
    }

    // 4. Clone Filter
    if (isShowingClonesOnly) {
        params.set('clones', 'true');
    }

    // 5. NEW: Affinity Filters
    const affinityString = getAffinityStringFromState();
    if (affinityString) {
        params.set('affinity', affinityString);
    }

    // 6. Min/Max Stat Filters
    const minMaxString = getMinMaxStringFromState();
    if (minMaxString) {
        params.set('minmax', minMaxString);
    }

    const queryString = params.toString();
    let newUrl;

    // Check if the query string is empty to prevent trailing '?'
    if (queryString) {
        newUrl = `${window.location.pathname}?${queryString}${window.location.hash}`;
    } else {
        newUrl = `${window.location.pathname}${window.location.hash}`;
    }
    
    if (replace) {
        history.replaceState(null, '', newUrl); // Use replaceState on initial load
    } else {
        history.pushState(null, '', newUrl); // Use pushState on user action
    }
}

// Loads state from the URL and applies it (checks checkboxes, sets sort, populates IDs)
function loadStateFromURL() {
    const params = new URLSearchParams(window.location.search);

    // 1. Load Sort Order
    const urlSort = params.get('sort');
    if (urlSort) {
        currentSortOrder = urlSort;
    }

    // 2. Load Selected IDs
    const urlIDs = params.get('ids');
    if (urlIDs) {
        const ids = urlIDs.split(',').map(id => id.trim()).filter(id => id);
        selectedIDs = new Set(ids);
    }
    
    // 3. Load Clone Filter
    const urlClones = params.get('clones');
    isShowingClonesOnly = (urlClones === 'true');

    // 4. Load Trait Filters
    let hasFilters = false;
    const urlTraits = params.get('traits');
    if (urlTraits) {
        const traitGroups = urlTraits.split(';');
        traitGroups.forEach(group => {
            const [type, valuesString] = group.split(':');
            if (type && valuesString) {
                const values = valuesString.split(',').map(v => decodeURIComponent(v));
                values.forEach(value => {
                    const checkbox = document.querySelector(`.trait-checkbox[data-trait-type="${type}"][data-trait-value="${value}"]`);
                    if (checkbox) {
                        checkbox.checked = true;
                        hasFilters = true;
                    }
                });
            }
        });
    }
    
    // 5. MODIFIED: Load Affinity and sync trait checkboxes
    const urlAffinity = params.get('affinity');
    if (urlAffinity) {
        const affinityGroups = urlAffinity.split(';');
        affinityGroups.forEach(group => {
            const [type, valuesString] = group.split(':');
            if (type && valuesString) {
                const values = valuesString.split(',');
                values.forEach(affinityValue => {
                    if (type === 'body') selectedBodyAffinities.add(affinityValue);
                    else if (type === 'hand') selectedHandAffinities.add(affinityValue);

                    // Sync checkboxes: Check every trait belonging to this affinity
                    Object.values(traitsData).forEach(nft => {
                        const trait = nft[type];
                        if (trait && typeof trait === 'object' && trait.affinity === affinityValue) {
                            const cb = document.querySelector(`.trait-checkbox[data-trait-type="${type}"][data-trait-value="${trait.name}"]`);
                            if (cb) cb.checked = true;
                        }
                    });
                });
                hasFilters = true;
            }
        });

        // Set Expected Mode: Show section and activate buttons
        const affinitySection = document.querySelector('.affinity-filter-section');
        const toggleBtn = document.getElementById('affinityFilterToggle');
        if (affinitySection && toggleBtn) {
            affinitySection.style.display = 'block';
            toggleBtn.classList.add('active');
        }
        updateAffinityButtonStates();
    }
    
    // 6. Load Min/Max Stat Filters
    const urlMinMax = params.get('minmax');
    if (urlMinMax) {
        urlMinMax.split(';').forEach(part => {
            const [statName, value, mode] = part.split(':');
            if (statName && value && statMinMaxFilters[statName] !== undefined) {
                const isMax = mode === 'max';
                statMinMaxFilters[statName].value = Number(value);
                statMinMaxFilters[statName].isMax = isMax;

                // Sync slider
                const slider = document.querySelector(`.stat-control.${statName} .stat-control-input`);
                const valueDisplay = document.querySelector(`.stat-control.${statName} .stat-control-input-value`);
                const toggleInput = document.querySelector(`.stat-control.${statName} .toggle-input`);
                if (slider) slider.value = value;
                if (valueDisplay) valueDisplay.textContent = value;
                if (toggleInput) toggleInput.checked = isMax;
            }
        });

        // Show the section and activate the toggle button
        const minmaxSection = document.querySelector('.minmax-filter-section');
        const toggleBtn = document.getElementById('minmaxFilterToggle');
        if (minmaxSection && toggleBtn) {
            minmaxSection.style.display = 'block';
            toggleBtn.classList.add('active');
        }
        hasFilters = true;
    }

    return hasFilters;
}

// Handles browser back/forward button clicks
function handlePopState() {
    // 1. Sync state from URL
    const hasFilters = loadStateFromURL();

    // 2. Sync UI Elements
    updateSelectedIDsDisplay(); 
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    const sortButton = document.querySelector(`.sort-btn[data-sort="${currentSortOrder}"]`);
    if (sortButton) sortButton.classList.add('active');

    const cloneBtn = document.getElementById('cloneFilterBtn');
    if (cloneBtn) {
        isShowingClonesOnly ? cloneBtn.classList.add('active') : cloneBtn.classList.remove('active');
    }

    // 3. Re-render
    if (isShowingClonesOnly) {
        filterClones(); // This now uses the centralized logic
    } else if (hasFilters) {
        filterByTraits(); // This now uses the centralized logic
    } else {
        isFiltering = false;
        allNFTIds = getSortedNFTIds();
        loadInitialNFTs();
    }
}

// --- END URL SYNCHRONIZATION FUNCTIONS ---


// Cache-busting timestamp generator
function getCacheBuster() {
    return new Date().getTime();
}

// Smooth loader display
function showLoader() {
    const loader = document.querySelector('.loader');
    loader.style.display = 'block';
    loader.style.opacity = '1';
}

function hideLoader() {
    const loader = document.querySelector('.loader');
    loader.style.opacity = '0';
    
    // Start tracking
    if (typeof window.startHonestTracking === 'function') {
        window.startHonestTracking();
    }

    // NEW: Trigger the Live Counter exactly when the loader fades!
    // We use a tiny 300ms delay to match the loader's fade-out time
    setTimeout(() => {
        updateLiveStatus();
        loader.style.display = 'none';
    }, 300);

    // Keep the interval separate so it keeps running every minute
    if (!window.liveStatusInterval) {
        window.liveStatusInterval = setInterval(updateLiveStatus, 60000);
    }
}

function showContainer() {
    const container = document.querySelector('.container');
    container.style.display = 'block';
    setTimeout(() => {
        container.style.opacity = '1';
    }, 50);
}

// Helper function to get trait name from data (handles both old and new format)
function getTraitName(traitData) {
    return typeof traitData === 'string' ? traitData : traitData.name;
}

// Create a unique signature for an NFT based on its traits
function createTraitSignature(traits) {
    // Sort trait categories alphabetically for consistent signatures
    const sortedCategories = Object.keys(traits).sort();
    
    // Create a string signature: "category1:value1|category2:value2|..."
    const signature = sortedCategories
        .map(category => `${category}:${getTraitName(traits[category])}`)
        .join('|');
    
    return signature;
}

// Build trait signatures for all NFTs and identify clones
function buildTraitSignatures() {
    const signatures = {};
    const signatureGroups = {}; // Group IDs by signature
    
    Object.entries(traitsData).forEach(([id, traits]) => {
        const signature = createTraitSignature(traits);
        signatures[id] = signature;
        
        if (!signatureGroups[signature]) {
            signatureGroups[signature] = [];
        }
        signatureGroups[signature].push(id);
    });
    
    // Store clone information
    const cloneInfo = {
        signatures: signatures,
        groups: signatureGroups,
        cloneIds: new Set() // IDs that are clones (have duplicates)
    };
    
    // Identify which IDs are clones (signatures that appear more than once)
    Object.entries(signatureGroups).forEach(([signature, ids]) => {
        if (ids.length > 1) {
            ids.forEach(id => cloneInfo.cloneIds.add(id));
        }
    });
    
    return cloneInfo;
}

// Calculate trait occurrence counts
function calculateTraitCounts() {
    const counts = {};
    
    Object.values(traitsData).forEach(nft => {
        Object.entries(nft).forEach(([category, traitData]) => {
            const traitName = getTraitName(traitData);
            
            if (!counts[category]) {
                counts[category] = {};
            }
            if (!counts[category][traitName]) {
                counts[category][traitName] = 0;
            }
            counts[category][traitName]++;
        });
    });
    
    return counts;
}

// OpenRarity implementation
function calculateRarityScores() {
    const totalNFTs = Object.keys(traitsData).length;
    const scores = {};
    
    // Step 1: Calculate Information Content (IC) for each trait
    // IC = -log(probability) where probability = trait_count / total_nfts
    const traitIC = {};
    Object.entries(traitCounts).forEach(([category, traits]) => {
        traitIC[category] = {};
        Object.entries(traits).forEach(([traitName, count]) => {
            const probability = count / totalNFTs;
            // Information Content: higher IC = rarer trait
            traitIC[category][traitName] = -Math.log(probability);
        });
    });
    
    // Step 2: Calculate max IC per trait category for normalization
    const maxICPerCategory = {};
    Object.entries(traitIC).forEach(([category, traits]) => {
        maxICPerCategory[category] = Math.max(...Object.values(traits));
    });
    
    // Step 3: Calculate normalized rarity score for each NFT
    Object.entries(traitsData).forEach(([id, traits]) => {
        let normalizedScore = 0;
        
        Object.entries(traits).forEach(([category, traitData]) => {
            const traitName = getTraitName(traitData);
            const ic = traitIC[category][traitName];
            const maxIC = maxICPerCategory[category];
            
            // Normalize IC by dividing by max IC in category
            // This ensures each trait category contributes equally
            const normalizedIC = ic / maxIC;
            normalizedScore += normalizedIC;
        });
        
        // Average across all trait categories for final score
        const numTraitCategories = Object.keys(traits).length;
        scores[id] = normalizedScore / numTraitCategories;
    });
    
    // Step 4: Rank NFTs by score (higher score = rarer)
    const sortedByScore = Object.entries(scores)
        .sort((a, b) => b[1] - a[1]);
    
    const rankedScores = {};
    let currentRank = 1;
    let previousScore = null;
    let tieCount = 0;

    sortedByScore.forEach(([id, score], index) => {
        // If score is different from previous, update rank
        if (previousScore !== null && score !== previousScore) {
            currentRank = index + 1;
            tieCount = 0;
        } else if (previousScore === score) {
            tieCount++;
        }
        
        rankedScores[id] = {
            score: score,
            rank: currentRank,
            isTied: tieCount > 0 || (index < sortedByScore.length - 1 && sortedByScore[index + 1][1] === score)
        };
        
        previousScore = score;
    });
    
    return rankedScores;
}

// NEW: Extract affinity data from traits
function extractAffinityData() {
    const affinities = {};
    
    Object.entries(traitsData).forEach(([id, traits]) => {
        affinities[id] = {
            body: 'NORMAL', // default
            hand: 'NORMAL'  // default
        };
        
        // Extract body affinity
        if (traits.body && typeof traits.body === 'object' && traits.body.affinity) {
            affinities[id].body = traits.body.affinity;
        }
        
        // Extract hand affinity
        if (traits.hand && typeof traits.hand === 'object' && traits.hand.affinity) {
            affinities[id].hand = traits.hand.affinity;
        }
    });
    
    return affinities;
}

// Get sorted NFT IDs based on current sort order (with stats support)
// ALWAYS keeps clone groups together
function getSortedNFTIds(idsToSort) {
    const ids = idsToSort || Object.keys(traitsData);
    
    // Helper function to get stat value
    const getStatValue = (id, sortOrder) => {
        switch(sortOrder) {
            case 'rarity':
                return nftRarityScores[id]?.rank || 9999;
            case 'harmony':
                return kamiStatsData[id]?.stats.harmony || 0;
            case 'health':
                return kamiStatsData[id]?.stats.health || 0;
            case 'power':
                return kamiStatsData[id]?.stats.power || 0;
            case 'violence':
                return kamiStatsData[id]?.stats.violence || 0;
            default:
                return 0;
        }
    };
    
    // 1. CHRONOLOGICAL SORTING (Latest/Oldest)
    if (currentSortOrder === 'latest' || currentSortOrder === 'oldest') {
        if (isShowingClonesOnly) {
            // Group clones together based on a representative member
            const signatureToRepId = {};
            ids.forEach(id => {
                const sig = traitSignatures.signatures[id];
                const numId = Number(id);
                if (!signatureToRepId[sig]) {
                    signatureToRepId[sig] = numId;
                } else {
                    if (currentSortOrder === 'latest') {
                        signatureToRepId[sig] = Math.max(signatureToRepId[sig], numId);
                    } else {
                        signatureToRepId[sig] = Math.min(signatureToRepId[sig], numId);
                    }
                }
            });
            
            return ids.sort((a, b) => {
                const sigA = traitSignatures.signatures[a];
                const sigB = traitSignatures.signatures[b];
                if (sigA !== sigB) {
                    const repA = signatureToRepId[sigA];
                    const repB = signatureToRepId[sigB];
                    return currentSortOrder === 'latest' ? repB - repA : repA - repB;
                }
                // Within a clone group, always sort by ID
                return currentSortOrder === 'latest' ? Number(b) - Number(a) : Number(a) - Number(b);
            });
        } else {
            // Standard individual sorting (No grouping)
            return ids.sort((a, b) => {
                return currentSortOrder === 'latest' ? Number(b) - Number(a) : Number(a) - Number(b);
            });
        }
    }
    
    // 2. STAT/RARITY SORTING (Always groups clones)
    return ids.sort((a, b) => {
        const sigA = traitSignatures.signatures[a];
        const sigB = traitSignatures.signatures[b];
        
        // Step A: If they belong to different clone groups
        if (sigA !== sigB) {
            const statA = getStatValue(a, currentSortOrder);
            const statB = getStatValue(b, currentSortOrder);
            
            // If the stats are different, sort by stat
            if (statA !== statB) {
                if (currentSortOrder === 'rarity') return statA - statB;
                return statB - statA;
            }
            
            // IF STATS ARE EQUAL: Tiebreaker is the LATEST ID in each group
            // This ensures groups with the same Harmony/Health etc. are listed newest first
            const repA = Math.max(...traitSignatures.groups[sigA].map(Number));
            const repB = Math.max(...traitSignatures.groups[sigB].map(Number));
            return repB - repA; 
        }
        
        // Step B: If they are in the same clone group
        // Always list the newest ID of that specific group first
        return Number(b) - Number(a);
    });
}

// Setup sort button event listeners
function setupSortButtons() {
    const sortButtons = document.querySelectorAll('.sort-btn');
    
    sortButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const newSort = e.target.dataset.sort;
            
            // Check if we are clearing the sort back to default
            if (newSort === 'latest' && currentSortOrder === 'latest') {
                 // Do nothing if already on default and trying to set default
                 return;
            } else if (newSort !== currentSortOrder) {
                currentSortOrder = newSort;
                
                sortButtons.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                // FIXED: Re-apply the active filter state after sort change
                if (isShowingClonesOnly) {
                    filterClones(); // Re-sort and display clones
                } else if (isFiltering) {
                    filterByTraits(); // Re-apply trait filters with new sort
                } else {
                    // Just re-sort all NFTs
                    allNFTIds = getSortedNFTIds();
                    loadInitialNFTs();
                }
                
                // Update selected cards display to match new sort order
                if (selectedIDs.size > 0) {
                    updateSelectedIDsDisplay();
                }
                
                updateURL(); // Update URL after all changes
            }
        });
    });
}

// Setup clone filter button
function setupCloneFilterButton() {
    const cloneBtn = document.getElementById('cloneFilterBtn');
    if (!cloneBtn) return;
    
    cloneBtn.addEventListener('click', () => {
        isShowingClonesOnly = !isShowingClonesOnly;
        
        if (isShowingClonesOnly) {
            cloneBtn.classList.add('active');
            filterClones();
        } else {
            cloneBtn.classList.remove('active');
            // Return to normal view
            if (isFiltering) {
                filterByTraits();
            } else {
                const hasAffinityFilters = selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0; // NEW
                if (hasAffinityFilters) { // NEW
                    filterByTraits(); // NEW
                } else { // NEW
                    allNFTIds = getSortedNFTIds();
                    loadInitialNFTs();
                } // NEW
            }
        }
        
        updateURL();
    });
}

function filterClones() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.textContent = '';
    
    // 1. Identify which IDs to display
    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    const hasTraitFilters = checkboxes.length > 0;
    const hasAffinityFilters = selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;
    
    let cloneIds;
    if (hasTraitFilters && isFiltering) {
        // Intersection of current trait filters and clone IDs
        cloneIds = filteredNFTIds.filter(id => traitSignatures.cloneIds.has(id));
    } else {
        // All known clones
        cloneIds = Array.from(traitSignatures.cloneIds);
    }
    
    // Apply affinity filters to clone IDs
    if (hasAffinityFilters) {
        cloneIds = cloneIds.filter(id => {
            const nftAffinity = affinityData[id];
            if (!nftAffinity) return false;
            
            const bodyMatch = selectedBodyAffinities.size === 0 || selectedBodyAffinities.has(nftAffinity.body);
            const handMatch = selectedHandAffinities.size === 0 || selectedHandAffinities.has(nftAffinity.hand);
            
            return bodyMatch && handMatch;
        });
    }

    // Apply stat min/max filters to clone IDs
    if (hasActiveStatFilters()) {
        cloneIds = cloneIds.filter(id => passesStatMinMaxFilters(id));
    }
    
    // 2. Use the centralized sorting logic
    filteredNFTIds = getSortedNFTIds(cloneIds);
    isFiltering = true; 
    
    // --- NEW: AFFINITY NOTATION LOGIC ---
    let affinityNotation = "";
    if (hasAffinityFilters) {
        const affinityMap = {
            'NORMAL': 'N',
            'INSECT': 'I',
            'SCRAP': 'S',
            'EERIE': 'E'
        };

        // UI logic typically handles single affinity selection via Sets
        const bValue = Array.from(selectedBodyAffinities)[0];
        const hValue = Array.from(selectedHandAffinities)[0];

        const bChar = bValue ? (affinityMap[bValue] || "?") : "";
        const hChar = hValue ? (affinityMap[hValue] || "?") : "";
            
        affinityNotation = ` (${bChar}/${hChar})`;
    }
    // ------------------------------------

    // 3. UI Construction
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    
    const uniqueSignatures = new Set();
    cloneIds.forEach(id => {
        uniqueSignatures.add(traitSignatures.signatures[id]);
    });
    
    // Build filter summary buttons if trait filters are active
    let filterSummaryHTML = '';
    if (hasTraitFilters) {
        const selectedTraits = {};
        checkboxes.forEach(checkbox => {
            const traitType = checkbox.dataset.traitType;
            const traitValue = checkbox.dataset.traitValue;
            if (!selectedTraits[traitType]) selectedTraits[traitType] = [];
            selectedTraits[traitType].push(traitValue);
        });
        
        let summaryButtonsHTML = Object.entries(selectedTraits).map(([type, values]) => 
            values.map(value => `
                <button class="count-header-trait-btn" data-trait-type="${type}" data-trait-value="${value}">
                    ${type}: ${value} ×
                </button>`).join('')
        ).join('');
        
        filterSummaryHTML = `<div class="filter-summary-buttons-container" style="display: flex; flex-wrap: wrap; gap: 5px; margin: 10px;">${summaryButtonsHTML}</div>`;
    }
    
    countDiv.innerHTML = `
        <div id="count-summary" style="font-size: 14px;">
            Found ${cloneIds.length} clones in ${uniqueSignatures.size} groups${affinityNotation}
        </div>
        <div class="note">** dear mobile user, click card to show og stats **</div>
        ${filterSummaryHTML}
        ${buildStatFilterSummaryHTML()}
    `;
    
    resultsDiv.appendChild(countDiv);
    attachStatFilterSummaryListeners(countDiv);
    
    // Re-attach listeners to the new summary buttons
    countDiv.querySelectorAll('.count-header-trait-btn:not(.stat-filter-summary-btn)').forEach(btn => {
        btn.addEventListener('click', removeSelectedTrait);
    });
    if (filteredNFTIds.length === 0) {
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.textContent = 'No clones found with current filters';
        resultsDiv.appendChild(noResultsDiv);
        return;
    }
    
    currentLoadIndex = 0;
    loadMoreNFTs();
    setupInfiniteScroll();
}

// Enhanced fetch function with cache-busting and proper headers
async function fetchWithCacheBusting(url, options = {}) {
    const cacheBuster = getCacheBuster();
    const urlWithCacheBuster = `${url}?v=${cacheBuster}`;
    
    const fetchOptions = {
        ...options,
        headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            ...options.headers
        },
        cache: 'no-store'
    };
    
    return fetch(urlWithCacheBuster, fetchOptions);
}

async function loadSacrificeData(v) {
    try {
    // Uses the timestamp to ensure the API doesn't return a cached 403 or old data
    const response = await fetch(`/api/sacrifices?v=${v}`);
        
        if (response.ok) {
            const data = await response.json();
            sacrificedNFTs = new Set(data.map(item => String(item.kami_index)));
            console.log(`🕳️ Loaded ${sacrificedNFTs.size} sacrifice records`);
        }
    } catch (err) {
        // Silent fail
    }
}

/**
 * Fetch the full bundle once, split it into the 5 data sections,
 * and immediately release the bundle reference so the GC can free it.
 * Populates the global variables directly; returns nothing.
 */
async function fetchAndSplitBundle(v) {
    // 1. Figure out WHERE to look
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.');
    
    // If local, go directly to Cloudflare. If live, use the "middleman" path.
    const finalUrl = isLocal 
        ? `https://data.kami.h80h.xyz/kamiBundle.json?v=${v}` 
        : `/api/data/kamiBundle.json?v=${v}`;

    const response = await fetch(finalUrl);
    if (!response.ok) {
        throw new Error(`Failed to load kamiBundle.json: ${response.status}`);
    }

    // Parse into a local variable
    let bundle = await response.json();

    // 2. Validate the bundle
    if (!bundle.kamiImage || !bundle.kamiTraits) {
        bundle = null; 
        throw new Error('Bundle is missing required sections (kamiImage / kamiTraits)');
    }

    // 3. Move data to global variables and clean up memory (Good for mobile!)
    imagesData = bundle.kamiImage;   bundle.kamiImage   = null;
    traitsData  = bundle.kamiTraits; bundle.kamiTraits  = null;

    if (bundle.kamiStats) {
        kamiStatsData = bundle.kamiStats;
    } else {
        kamiStatsData = {};
    }
    bundle.kamiStats = null;

    if (bundle.kamiMetadata) {
        metadataInfo = bundle.kamiMetadata;
    } else {
        metadataInfo = { newKamiIds: [] };
    }
    bundle.kamiMetadata = null;

    if (bundle.kamiListed) {
        listedNFTs = new Set(bundle.kamiListed.map(String));
        console.log(`🛍️ Loaded ${listedNFTs.size} Kamigotchi which is listed on KamiSwap`);
    } else {
        listedNFTs = new Set();
    }
    bundle.kamiListed = null;

    // 4. Fully release the bundle for Garbage Collection
    bundle = null;
}

// Load all data via a single bundle fetch
async function loadData() {
    try {
        console.log('📄 Loading bundle with cache-busting...');

        // --- CACHE BUSTING STRATEGY ---
        // We create a version string based on the current time.
        // This forces Cloudflare and Vercel to bypass their 5-minute cache.
        const v = Date.now(); 
        
        // Single network request + sacrifice fetch run in parallel
        // We pass the timestamp to our fetching functions
        await Promise.all([
            fetchAndSplitBundle(v), // Pass 'v' here
            loadSacrificeData(v),   // Pass 'v' here
        ]);

        if (Object.keys(kamiStatsData).length > 0) {
            console.log(`✅ Loaded stats data for ${Object.keys(kamiStatsData).length} Kamigotchi`);
        }

        if (metadataInfo.newKamiIds?.length > 0) {
            console.log(`✨ Found ${metadataInfo.newKamiIds.length} new Kamigotchi!`);
            console.log(`   New IDs: ${metadataInfo.newKamiIds.join(', ')}`);
        }
        
        // NEW: Extract affinity data
        affinityData = extractAffinityData();
        
        // Build trait signatures for clone detection
        traitSignatures = buildTraitSignatures();

        traitCounts = calculateTraitCounts();
        nftRarityScores = calculateRarityScores();
        console.log('✅ OpenRarity calculation complete!');
        
        // Setup controls
        setupSortButtons();
        setupCloneFilterButton();
        setupAffinityFilterToggle(); 
        setupMinMaxFilterToggle(); 
        setupAffinityFilters();
        createFilterControls();
        
        // --- URL Integration START ---
        const initialFilterActive = loadStateFromURL(); 
        
        // Update sort button visual state based on URL
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        const sortButton = document.querySelector(`.sort-btn[data-sort="${currentSortOrder}"]`);
        if (sortButton) sortButton.classList.add('active');

        // Update clone button visual state
        const cloneBtn = document.getElementById('cloneFilterBtn');
        if (cloneBtn && isShowingClonesOnly) {
            cloneBtn.classList.add('active');
        }

        updateSelectedIDsDisplay(); // Display IDs loaded from URL
        
        allNFTIds = getSortedNFTIds(); // Sort all IDs initially

        // Handle filter state on page load
        if (initialFilterActive) {
            // Trait filters are active (will handle clone filter if also active)
            filterByTraits();
        } else if (isShowingClonesOnly) {
            // Only clone filter is active
            filterClones();
        } else {
            // No filters active
            loadInitialNFTs();
        }
        
        updateURL(true); // Replace initial URL with the canonical state
        // --- URL Integration END ---
        
    } catch (error) {
        console.error('Detailed error:', error);
        document.getElementById('results').innerHTML = 
            `<div class="no-results">
                <strong>Error loading NFT data</strong><br><br>
                ${error.message}<br><br>
                <strong>Troubleshooting:</strong><br>
                1. Make sure you're running a local server (not opening HTML directly)<br>
                2. Check that kamiImage.json and kamiTraits.json are in the same folder<br>
                3. Check the browser console (F12) for more details<br>
                4. Try clicking the refresh button
            </div>`;
    } finally {
        hideLoader();
        showContainer();
    }
}

// Refresh data without reloading entire page
async function refreshData() {
    if (isRefreshing) return;
    
    isRefreshing = true;
    const refreshBtn = document.getElementById('refreshDataBtn');
    const originalText = refreshBtn.innerHTML;
    
    refreshBtn.disabled = true;
    
    try {
        console.log('🔄 Refreshing data...');
        
        // Save current filters
        const currentFilters = getTraitStringFromState();
        const currentSort = currentSortOrder;
        const wasShowingClones = isShowingClonesOnly;
        
        const v = Date.now(); 
        
        await Promise.all([
            fetchAndSplitBundle(v),
            loadSacrificeData(v),   
        ]);
        
        if (Object.keys(kamiStatsData).length > 0) {
            console.log(`✅ Re-loaded stats data for ${Object.keys(kamiStatsData).length} Kamigotchi`);
        }

        if (metadataInfo.newKamiIds?.length > 0) {
            console.log(`✨ Found ${metadataInfo.newKamiIds.length} new Kamigotchi!`);
            console.log(`   New IDs: ${metadataInfo.newKamiIds.join(', ')}`);
        } else {
            console.log("💤 No new Kamigotchi")
        }

        // NEW: Re-extract affinity data
        affinityData = extractAffinityData();
        
        // Rebuild trait signatures
        traitSignatures = buildTraitSignatures();

        // Recalculate everything with OpenRarity
        traitCounts = calculateTraitCounts();
        nftRarityScores = calculateRarityScores();
        console.log('✅ OpenRarity recalculation complete!');
        
        // Restore sort and filters
        currentSortOrder = currentSort;
        isShowingClonesOnly = wasShowingClones;
        allNFTIds = getSortedNFTIds();
        
        // Rebuild filter controls with updated data
        const filterControls = document.getElementById('filterControls');
        filterControls.innerHTML = '';
        createFilterControls();
        
        // Restore filters by manually setting the checkboxes
        if (currentFilters) {
             const params = new URLSearchParams();
             params.set('traits', currentFilters);
             
             // Temporarily set the URL search string to reload the state
             const originalSearch = window.location.search;
             history.replaceState(null, '', `?${params.toString()}`);
             loadStateFromURL();
             history.replaceState(null, '', originalSearch); // Restore original URL
        }
        
        // Update clone button state
        const cloneBtn = document.getElementById('cloneFilterBtn');
        if (cloneBtn) {
            if (isShowingClonesOnly) {
                cloneBtn.classList.add('active');
            } else {
                cloneBtn.classList.remove('active');
            }
        }
        
        // Reload display based on active filters
        if (isShowingClonesOnly) {
            filterClones();
        } else if (currentFilters) {
            filterByTraits();
        } else {
            isFiltering = false;
            loadInitialNFTs();
        }
        
        updateURL(true); // Ensure final URL reflects current state
        
        // Show success feedback
        refreshBtn.innerHTML = `<svg id="refreshComplete" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><mask id="SVGkzXYXbbR"><g fill="none" stroke="#fff" stroke-dasharray="24" stroke-dashoffset="24" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.4s" values="24;0"/></path><path stroke="#000" stroke-width="6" d="M7.5 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.4s" dur="0.4s" values="24;0"/></path><path d="M7.5 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.4s" dur="0.4s" values="24;0"/></path></g></mask><rect width="24" height="24" fill="currentColor" mask="url(#SVGkzXYXbbR)"/></svg>`;
        setTimeout(() => {
            refreshBtn.innerHTML = originalText;
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = '1';
            isRefreshing = false;
        }, 2000);
        
    } catch (error) {
        console.error('Error refreshing data:', error);
        // Using custom modal/message box instead of alert()
        const messageBox = document.getElementById('messageBox');
        messageBox.textContent = 'Failed to refresh data. Please try again.';
        messageBox.style.display = 'block';
        setTimeout(() => messageBox.style.display = 'none', 3000);

        refreshBtn.innerHTML = originalText;
        refreshBtn.disabled = false;
        refreshBtn.style.opacity = '1';
        isRefreshing = false;
    }
}

function loadInitialNFTs() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.textContent = '';
    
    const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
    
    let title = 'Showing all Kamigotchi';
    if (isShowingClonesOnly) {
        const uniqueSignatures = new Set();
        idsToDisplay.forEach(id => {
            uniqueSignatures.add(traitSignatures.signatures[id]);
        });
        title = `Showing ${idsToDisplay.length} clones in ${uniqueSignatures.size} groups`;
    } else if (isFiltering) {
        title = 'Found matching Kamigotchi';
    }
    
    const countDiv = createCountHeader(idsToDisplay.length, title);
    resultsDiv.appendChild(countDiv);
    
    currentLoadIndex = 0;
    loadMoreNFTs();
    setupInfiniteScroll();
}

function loadMoreNFTs() {
    if (isLoading) return;
    
    isLoading = true;
    const resultsDiv = document.getElementById('results');
    const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
    const endIndex = Math.min(currentLoadIndex + LAZY_LOAD_COUNT, idsToDisplay.length);
    
    requestAnimationFrame(() => {
        const fragment = document.createDocumentFragment();
        
        for (let i = currentLoadIndex; i < endIndex; i++) {
            const card = displayNFT(idsToDisplay[i], false);
            if (card) fragment.appendChild(card);
        }
        
        resultsDiv.appendChild(fragment);
        currentLoadIndex = endIndex;
        isLoading = false;
        updateLoadingIndicator();
    });
}

function createLoadingIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'loadingIndicator';
    indicator.className = 'loading-indicator';
    indicator.innerHTML = 'Loading more Kamigotchi...';
    indicator.style.display = 'none';
    return indicator;
}

function updateLoadingIndicator() {
    let indicator = document.getElementById('loadingIndicator');
    
    if (!indicator) {
        indicator = createLoadingIndicator();
        document.getElementById('results').appendChild(indicator);
    }
    
    const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
    if (currentLoadIndex >= idsToDisplay.length) {
        indicator.style.display = 'none';
    }
}

function setupInfiniteScroll() {
    if (nftObserver) {
        nftObserver.disconnect();
    }
    
    nftObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
            if (entry.isIntersecting && currentLoadIndex < idsToDisplay.length && !isLoading) {
                loadMoreNFTs();
            }
        });
    }, {
        rootMargin: '200px'
    });
    
    const observeLastCard = () => {
        const cards = document.querySelectorAll('.nft-card');
        if (cards.length > 0) {
            const lastCard = cards[cards.length - 1];
            nftObserver.observe(lastCard);
        }
    };
    
    setTimeout(observeLastCard, 100);
    
    const originalLoadMore = loadMoreNFTs;
    loadMoreNFTs = function() {
        originalLoadMore();
        setTimeout(observeLastCard, 100);
    };
}

function createCountHeader(count, title) {
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    countDiv.innerHTML = `
        <div style="font-size: 14px;">${title}: ${count}</div>
        <div class="note">** dear mobile user, click card to show og stats **<div>
    `;
    return countDiv;
}

function removeSelectedTrait(event) {
    const btn = event.currentTarget;
    const traitType = btn.dataset.traitType;
    const traitValue = btn.dataset.traitValue;
    
    const checkbox = document.querySelector(
        `.trait-checkbox[data-trait-type="${traitType}"][data-trait-value="${traitValue}"]`
    );
    
    if (checkbox) {
        checkbox.checked = false;
        updateSelectedTraitsDisplay(true);
    }
}

// MODIFIED: Added logic to stop affinity filter if traits are partially removed
function updateSelectedTraitsDisplay(forceUpdate = false) {
    const selectedTraitsDiv = document.getElementById('selectedTraitsDisplay');
    if (selectedTraitsDiv) selectedTraitsDiv.style.display = 'none';
    
    // 1. Sync Affinities: This now checks if any NEW traits were selected 
    // that aren't part of the current affinity sets.
    validateAffinitiesAgainstCheckboxes();

    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    
    if (checkboxes.length === 0 && (isFiltering || forceUpdate)) {
    isFiltering = false;
    filteredNFTIds = [];
    selectedBodyAffinities.clear();
    selectedHandAffinities.clear();
    updateAffinityButtonStates();

    if (isShowingClonesOnly) {
        filterClones();
    } else if (hasActiveStatFilters()) {
        filterByTraits();
    } else {
        allNFTIds = getSortedNFTIds(Object.keys(traitsData));
        loadInitialNFTs();
    }
    updateURL();
    return;
}
    
    updateURL(); 
    filterByTraits();
}

/**
 * NEW LOGIC: Validates that ONLY traits belonging to the active affinities are selected.
 * If a user selects a trait outside the affinity, the affinity filter is deactivated.
 */
function validateAffinitiesAgainstCheckboxes() {
    let stateChanged = false;

    ['body', 'hand'].forEach(type => {
        const activeAffinities = type === 'body' ? selectedBodyAffinities : selectedHandAffinities;
        
        // 1. Get all currently checked traits for this category
        const checkedBoxes = document.querySelectorAll(`.trait-checkbox[data-trait-type="${type}"]:checked`);
        const checkedTraitNames = Array.from(checkedBoxes).map(cb => cb.dataset.traitValue);

        // 2. Identify which affinities are represented by the current checkbox selection
        const representedAffinities = new Set();
        checkedTraitNames.forEach(name => {
            const nft = Object.values(traitsData).find(n => n[type]?.name === name);
            if (nft && nft[type]?.affinity) {
                representedAffinities.add(nft[type].affinity);
            }
        });

        // 3. Logic: An affinity should be "Active" IF AND ONLY IF:
        //    a) All traits belonging to that affinity are checked.
        //    b) No traits from OTHER affinities are checked in this category.
        
        // We only allow an affinity to be "active" if there is exactly ONE affinity type selected in this category
        if (representedAffinities.size === 1) {
            const currentAffinity = Array.from(representedAffinities)[0];
            
            // Get all traits that belong to this specific affinity
            const requiredTraits = new Set();
            Object.values(traitsData).forEach(nft => {
                if (nft[type]?.affinity === currentAffinity) {
                    requiredTraits.add(nft[type].name);
                }
            });

            // Check if every required trait is checked
            const isComplete = Array.from(requiredTraits).every(name => checkedTraitNames.includes(name));
            
            // If it's complete and wasn't active, or if it was active and is still complete
            if (isComplete) {
                if (!activeAffinities.has(currentAffinity)) {
                    activeAffinities.add(currentAffinity);
                    stateChanged = true;
                }
            } else {
                // Traits are missing from this affinity
                if (activeAffinities.size > 0) {
                    activeAffinities.clear();
                    stateChanged = true;
                }
            }
        } else {
            // Either 0 traits are selected, or traits from multiple affinities (e.g. NORMAL + INSECT)
            if (activeAffinities.size > 0) {
                activeAffinities.clear();
                stateChanged = true;
            }
        }
    });

    if (stateChanged) {
        updateAffinityButtonStates();
    }
}

function createFilterControls() {
    const filterControls = document.getElementById('filterControls');
    const allTraits = {};
    const traitDetails = {};
    
    Object.values(traitsData).forEach(nft => {
        Object.entries(nft).forEach(([traitType, traitData]) => {
            if (!allTraits[traitType]) {
                allTraits[traitType] = new Set();
                traitDetails[traitType] = {};
            }
            
            const traitName = getTraitName(traitData);
            allTraits[traitType].add(traitName);
            
            if (typeof traitData === 'object' && traitData.name) {
                if (!traitDetails[traitType][traitName]) {
                    traitDetails[traitType][traitName] = {
                        affinity: traitData.affinity || null,
                        stats: traitData.stats || {}
                    };
                }
            }
        });
    });
    
    const dropdownWrapper = document.createElement('div');
    dropdownWrapper.className = 'dropdown-wrapper';
    
    const dropdownLabel = document.createElement('label');
    dropdownLabel.textContent = 'Select Trait Category:';
    dropdownLabel.className = 'dropdown-label';
    
    const dropdown = document.createElement('select');
    dropdown.id = 'traitCategoryDropdown';
    dropdown.className = 'trait-dropdown';
    
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Choose a category --';
    dropdown.appendChild(defaultOption);
    
    Object.keys(allTraits).sort().forEach(traitType => {
        const option = document.createElement('option');
        option.value = traitType;
        option.textContent = traitType.charAt(0).toUpperCase() + traitType.slice(1);
        dropdown.appendChild(option);
    });
    
    dropdownWrapper.appendChild(dropdownLabel);
    dropdownWrapper.appendChild(dropdown);
    filterControls.appendChild(dropdownWrapper);
    
    const filterGroupsContainer = document.createElement('div');
    filterGroupsContainer.id = 'filterGroupsContainer';
    filterControls.appendChild(filterGroupsContainer);
    
    Object.keys(allTraits).sort().forEach(traitType => {
        const filterGroup = document.createElement('div');
        filterGroup.className = 'filter-group';
        filterGroup.dataset.traitType = traitType;
        filterGroup.style.display = 'none';
        
        const header = document.createElement('div');
        header.className = 'filter-header';
        header.textContent = traitType.charAt(0).toUpperCase() + traitType.slice(1);
        filterGroup.appendChild(header);
        
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'trait-search';
        searchInput.placeholder = `Search ${traitType}...`;
        searchInput.autocomplete = 'off';
        searchInput.dataset.traitType = traitType;
        filterGroup.appendChild(searchInput);
        
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'checkbox-container';
        checkboxContainer.dataset.traitType = traitType;
        
        const sortedValues = [...allTraits[traitType]].sort((a, b) => {
            const countA = traitCounts[traitType][a] || 0;
            const countB = traitCounts[traitType][b] || 0;
            return countA - countB;
        });
        
        sortedValues.forEach(value => {
            const count = traitCounts[traitType][value] || 0;
            const totalNFTs = Object.keys(traitsData).length;
            const percentage = ((count / totalNFTs) * 100).toFixed(1);
            
            const checkboxWrapper = document.createElement('label');
            checkboxWrapper.className = 'checkbox-label';
            checkboxWrapper.dataset.traitValue = value.toLowerCase();
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'trait-checkbox';
            checkbox.dataset.traitType = traitType;
            checkbox.dataset.traitValue = value;
            checkbox.addEventListener('change', () => updateSelectedTraitsDisplay(false));
            
            const details = traitDetails[traitType][value] || {};
            
            let affinityHTML = '';
            if (details.affinity && (traitType === 'body' || traitType === 'hand')) {
                affinityHTML = `<span class="trait-affinity ${details.affinity}" title="Affinity">${details.affinity}</span>`;
            }
            
            let statsHTML = '';
            if (details.stats && Object.keys(details.stats).length > 0) {
                const statBadges = Object.entries(details.stats)
                    .map(([statName, value]) => {
                        const sign = value > 0 ? '+' : '';
                        return `<span class="trait-stat ${statName}" title="${statName.charAt(0).toUpperCase() + statName.slice(1)}">${statName.slice(0, 3).toUpperCase()} ${sign}${value}</span>`;
                    })
                    .join('');
                statsHTML = `<span class="trait-stats">${statBadges}</span>`;
            }
            
            const span = document.createElement('span');
            span.className = 'trait-label-text';
            span.innerHTML = `
                <span class="trait-name-row">
                    <span class="trait-name">${value}</span>
                    ${affinityHTML}
                </span>
                <span class="trait-info-row">
                    <span class="trait-count">${count} (${percentage}%)</span>
                    ${statsHTML}
                </span>
            `;
            
            checkboxWrapper.appendChild(checkbox);
            checkboxWrapper.appendChild(span);
            checkboxContainer.appendChild(checkboxWrapper);
        });
        
        filterGroup.appendChild(checkboxContainer);
        filterGroupsContainer.appendChild(filterGroup);
        
        searchInput.addEventListener('input', (e) => {
            filterTraitOptions(traitType, e.target.value);
        });
    });
    
    dropdown.addEventListener('change', (e) => {
        const selectedCategory = e.target.value;
        const allFilterGroups = document.querySelectorAll('.filter-group');
        allFilterGroups.forEach(group => group.style.display = 'none');
        
        if (selectedCategory) {
            const selectedGroup = document.querySelector(`.filter-group[data-trait-type="${selectedCategory}"]`);
            if (selectedGroup) selectedGroup.style.display = 'block';
        }
    });
}

function filterTraitOptions(traitType, searchTerm) {
    const container = document.querySelector(`.checkbox-container[data-trait-type="${traitType}"]`);
    const checkboxLabels = container.querySelectorAll('.checkbox-label');
    const searchLower = searchTerm.toLowerCase().trim();
    
    let visibleCount = 0;
    
    checkboxLabels.forEach(label => {
        const traitValue = label.dataset.traitValue;
        if (searchLower === '' || traitValue.includes(searchLower)) {
            label.style.display = 'flex';
            visibleCount++;
        } else {
            label.style.display = 'none';
        }
    });
    
    let noResultsMsg = container.querySelector('.no-trait-results');
    if (visibleCount === 0) {
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('div');
            noResultsMsg.className = 'no-trait-results';
            noResultsMsg.textContent = 'No matching traits found';
            container.appendChild(noResultsMsg);
        }
    } else {
        if (noResultsMsg) noResultsMsg.remove();
    }
}

// Helper function to get stat color class based on current sort
function getStatColorClass() {
    const statSorts = ['harmony', 'health', 'power', 'violence'];
    return statSorts.includes(currentSortOrder) ? currentSortOrder : '';
}

// MODIFIED: Added check for sacrifice data and emoji badge
function displayNFT(id, showCloseButton = false) {
    const imageUrl = imagesData[id];
    const traits = traitsData[id];
    const stats = kamiStatsData[id];
    
    if (!imageUrl || !traits) {
        console.warn(`NFT #${id} not found in data`);
        return null;
    }
    
    const rarityData = nftRarityScores[id];
    const rank = rarityData ? rarityData.rank : '?';
    const score = rarityData ? rarityData.score.toFixed(4) : '?';
    const isTied = rarityData ? rarityData.isTied : false;
    
    const isNew = metadataInfo.kamiNewWindow && metadataInfo.kamiNewWindow.hasOwnProperty(String(id));
    const isClone = traitSignatures.cloneIds.has(id);
    const isSacrificed = sacrificedNFTs.has(String(id)); // NEW: Check sacrifice set
    const isListed = listedNFTs.has(String(id)); // Check if listed for sale
    
    const card = document.createElement('div');
    card.className = 'nft-card hover_wrapper';
    card.dataset.nftId = id;
    
    let rankClass = 'rank-common';
    const totalNFTs = Object.keys(traitsData).length;
    const rankPercentile = (rank / totalNFTs) * 100;
    
    if (rankPercentile <= 1) rankClass = 'rank-legendary';
    else if (rankPercentile <= 5) rankClass = 'rank-epic';
    else if (rankPercentile <= 15) rankClass = 'rank-rare';
    else if (rankPercentile <= 40) rankClass = 'rank-uncommon';
    
    // Get stat color class
    const statColorClass = getStatColorClass();
    
    // Get the stat value for the current sort
    const statValue = stats?.stats[currentSortOrder] || '';

    // Build stat color indicator HTML (only show if sorting by a stat)
    const statColorHTML = statColorClass ? 
        `<div class="stat-color-box ${statColorClass}" title="${statColorClass.charAt(0).toUpperCase() + statColorClass.slice(1)} Sort">${statValue}</div>` : '';
    
    let statsHTML = '';
    if (stats) {
        statsHTML = `
            <div class="kami-stats">
                <div class="stat-row one">
                    <div class="stat-item health">
                        
                        <div class="stat-value">${stats.stats.health}</div>
                    </div>
                    <div class="stat-item power">
                        
                        <div class="stat-value">${stats.stats.power}</div>
                    </div>
                </div>
                <div class="stat-row">
                    <div class="stat-item violence">
                        
                        <div class="stat-value">${stats.stats.violence}</div>
                    </div>
                    <div class="stat-item harmony">
                        
                        <div class="stat-value">${stats.stats.harmony}</div>
                    </div>
                </div>
            </div>
        `;
    }
    
    const traitsHTML = Object.entries(traits)
        .map(([key, traitData]) => {
            const traitName = getTraitName(traitData);
            return `
                <div class="trait">
                    <p>${key.charAt(0).toUpperCase() + key.slice(1)}: ${traitName}</p>
                </div>
            `;
        }).join('');
    
    const closeButtonHTML = showCloseButton ? 
        `<button class="close-btn" onclick="removeSelectedID('${id}')" title="Remove this Kamigotchi">×</button>` : '';
    
    const newBadgeHTML = isNew ? 
        `<div class="new-badge" title="Recently Added!">NEW</div>` : '';

    const cloneBadgeHTML = isClone ? 
        `<div class="clone-badge" title="This Kamigotchi has identical traits to others">CLONE</div>` : '';

    // NEW: Sacrifice Badge HTML
    const sacrificeBadgeHTML = isSacrificed ?
        `<div class="sacrifice-badge" title="This Kamigotchi has been sacrificed">🕳️</div>` : '';

    // listed Badge HTML
    const listedBadgeHTML = isListed ?
        `<div class="listed-badge" title="This Kamigotchi is listed on KamiSwap"><img id="kamiswap_icon" src="https://app.kamigotchi.io/assets/marketplace-BqMKbOFC.png" style="border: none"></div>` : '';
    
    // Check if mobile view
    const isMobile = window.innerWidth <= 390;

    // Prepare tooltip text
    const rankTooltip = isTied 
        ? `OpenRarity Rank: #${rank} (Tied) | Score: ${score}` 
        : `OpenRarity Rank: #${rank} | Score: ${score}`;

    // Build the card HTML based on screen size
    if (isMobile) {
        card.innerHTML = `
        ${closeButtonHTML}
        ${newBadgeHTML}
        ${cloneBadgeHTML}
        <div class="rank-stat-container">
            <div class="rank-badge ${rankClass}" title="Rarity Rank: #${rank} | Score: ${score}">
                ${rank}
            </div>
            ${statColorHTML}
        </div>
        <div class="nft-card-content">
            <div class="image-container">
                <img src="${imageUrl}" alt="NFT #${id}" loading="lazy" onerror="this.src='https://via.placeholder.com/250?text=Not+Found'">
                ${sacrificeBadgeHTML}
                ${listedBadgeHTML}
            </div>
            <div class="nft-details hover_wrapper">
                <div class="nft-id">Kamigotchi ${id}</div>
                ${traitsHTML}
                ${statsHTML}
            </div>
            
        </div>
        `;
    } else {
        card.innerHTML = `
        ${closeButtonHTML}
        ${newBadgeHTML}
        ${cloneBadgeHTML}
        <div class="rank-stat-container">
            <div class="rank-badge ${rankClass}" title="Rarity Rank: #${rank} | Score: ${score}">
                ${rank}
            </div>
            ${statColorHTML}
        </div>
        ${statsHTML}
        <div class="nft-card-content">
            <div class="image-container">
                <img src="${imageUrl}" alt="NFT #${id}" loading="lazy" onerror="this.src='https://via.placeholder.com/250?text=Image+Not+Found'">
                ${sacrificeBadgeHTML}
                ${listedBadgeHTML}
            </div>
            <div class="nft-details hover_wrapper">
                <div class="nft-id">Kamigotchi ${id}</div>
                ${traitsHTML}
            </div>
            
        </div>
        `;
    }
    
    card.addEventListener('click', (event) => {
        event.stopPropagation();
        const statsElement = card.querySelector('.kami-stats');
        if (statsElement) {
            statsElement.classList.toggle('is-active');
        }
    });

    document.addEventListener('click', (event) => {
        const statsElement = card.querySelector('.kami-stats');
        if (statsElement && statsElement.classList.contains('is-active')) {
            const isClickInsideContainer = card.contains(event.target);
            if (!isClickInsideContainer) {
                statsElement.classList.remove('is-active');
            }
        }
    });

    return card;
}

function updateSelectedIDsDisplay() {
    const selectedIDsDiv = document.getElementById('selectedIDs');
    
    if (selectedIDs.size === 0) {
        selectedIDsDiv.style.display = 'none';
    } else {
        selectedIDsDiv.style.display = 'block';
        selectedIDsDiv.innerHTML = '';
        
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'selected-cards-grid';

        // Sort selected IDs using the current sort order
        const selectedIDsArray = Array.from(selectedIDs);
        const sortedIDs = getSortedNFTIds(selectedIDsArray);
        
        sortedIDs.forEach(id => {
            const card = displayNFT(id, true);
            if (card) cardsContainer.appendChild(card);
        });
        
        selectedIDsDiv.appendChild(cardsContainer);
    }
    
    updateURL(); // Update URL whenever IDs change
}

function searchByID() {
    const searchInput = document.getElementById('searchInput');
    const id = searchInput.value.trim();
    
    if (!id) {
        // Using custom modal/message box instead of alert()
        const messageBox = document.getElementById('messageBox');
        messageBox.textContent = 'Please enter an NFT ID';
        messageBox.style.display = 'block';
        setTimeout(() => messageBox.style.display = 'none', 3000);
        return;
    }
    
    if (!imagesData[id] || !traitsData[id]) {
        // Using custom modal/message box instead of alert()
        const messageBox = document.getElementById('messageBox');
        messageBox.textContent = `Kamigotchi #${id} not found. Please check the ID and try again.`;
        messageBox.style.display = 'block';
        setTimeout(() => messageBox.style.display = 'none', 3000);
        return;
    }
    
    if (selectedIDs.has(id)) {
        // Using custom modal/message box instead of alert()
        const messageBox = document.getElementById('messageBox');
        messageBox.textContent = `Kamigotchi #${id} is already added!`;
        messageBox.style.display = 'block';
        setTimeout(() => messageBox.style.display = 'none', 3000);
        return;
    }
    
    selectedIDs.add(id);
    updateSelectedIDsDisplay();
    searchInput.value = '';
    
    updateURL(); // <<< URL Update
}

function removeSelectedID(id) {
    selectedIDs.delete(id);
    updateSelectedIDsDisplay();
    
    updateURL(); // <<< URL Update
}

window.removeSelectedID = removeSelectedID;

function clearAllSelectedIDs() {
    selectedIDs.clear();
    updateSelectedIDsDisplay();
    document.getElementById('searchInput').value = '';
    
    updateURL(); // <<< URL Update
}

function filterByTraits() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.textContent = '';

    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    const hasTraitFilters = checkboxes.length > 0;
    const hasAffinityFilters = selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;
    
    const hasStatFilters = hasActiveStatFilters();

    if (!hasTraitFilters && !hasAffinityFilters && !hasStatFilters) {
        isFiltering = false;
        
        if (isShowingClonesOnly) {
            filterClones();
        } else {
            allNFTIds = getSortedNFTIds(Object.keys(traitsData));
            loadInitialNFTs();
        }
        return;
    }
    
    const filteringMessage = document.createElement('div');
    filteringMessage.className = 'no-results';
    filteringMessage.textContent = 'Filtering...';
    resultsDiv.appendChild(filteringMessage);

    const selectedTraits = {};
    checkboxes.forEach(checkbox => {
        const traitType = checkbox.dataset.traitType;
        const traitValue = checkbox.dataset.traitValue;
        
        if (!selectedTraits[traitType]) {
            selectedTraits[traitType] = [];
        }
        selectedTraits[traitType].push(traitValue);
    });
    
    let baseIDs = isShowingClonesOnly ? Array.from(traitSignatures.cloneIds) : Object.keys(traitsData);

    let matchingNFTs = baseIDs.filter(id => {
        const nftTraits = traitsData[id];
        return Object.entries(selectedTraits).every(([traitType, selectedValues]) => {
            const nftTraitName = getTraitName(nftTraits[traitType]);
            return selectedValues.includes(nftTraitName);
        });
    });
    
    if (hasAffinityFilters) {
        matchingNFTs = matchingNFTs.filter(id => {
            const nftAffinity = affinityData[id];
            if (!nftAffinity) return false;
            
            const bodyMatch = selectedBodyAffinities.size === 0 || selectedBodyAffinities.has(nftAffinity.body);
            const handMatch = selectedHandAffinities.size === 0 || selectedHandAffinities.has(nftAffinity.hand);
            
            return bodyMatch && handMatch;
        });
    }

    // Apply stat min/max filters
    if (hasStatFilters) {
        matchingNFTs = matchingNFTs.filter(id => passesStatMinMaxFilters(id));
    }
    
    filteredNFTIds = getSortedNFTIds(matchingNFTs);
    isFiltering = true;
    
    if (isShowingClonesOnly) {
        filterClones();
        return;
    }
    
    resultsDiv.textContent = '';
    
    // --- NEW: AFFINITY NOTATION LOGIC ---
    let affinityNotation = "";
    if (hasAffinityFilters) {
        const affinityMap = {
            'NORMAL': 'N',
            'INSECT': 'I',
            'SCRAP': 'S',
            'EERIE': 'E'
        };

        // Get the first item from the Sets (since UI logic handles single affinity selection)
        const bValue = Array.from(selectedBodyAffinities)[0];
        const hValue = Array.from(selectedHandAffinities)[0];

        const bChar = bValue ? (affinityMap[bValue] || "?") : "";
        const hChar = hValue ? (affinityMap[hValue] || "?") : "";
            
        affinityNotation = ` (${bChar}/${hChar})`;
    }
    // ------------------------------------

    let summaryButtonsHTML = '';
    Object.entries(selectedTraits).forEach(([type, values]) => {
        values.forEach(value => {
            summaryButtonsHTML += `
                <button class="count-header-trait-btn" 
                        data-trait-type="${type}" 
                        data-trait-value="${value}"
                        title="Click to remove filter: ${type}: ${value}">
                    ${type}: ${value} ×
                </button>
            `;
        });
    });
    
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    countDiv.innerHTML = `
        <div id="count-summary" style="font-size: 14px;">
            Found matching Kamigotchi: ${filteredNFTIds.length}${affinityNotation}
        </div>
        <div class="note">** dear mobile user, click card to show og stats **</div>
        <div class="filter-summary-buttons-container" style="display: flex; flex-wrap: wrap; gap: 5px; margin: 10px;">
            ${summaryButtonsHTML}
        </div>
        ${buildStatFilterSummaryHTML()}
    `;

    resultsDiv.appendChild(countDiv);
    
    countDiv.querySelectorAll('.count-header-trait-btn:not(.stat-filter-summary-btn)').forEach(btn => {
        btn.addEventListener('click', removeSelectedTrait);
    });
    attachStatFilterSummaryListeners(countDiv);

    if (filteredNFTIds.length === 0) {
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.textContent = 'No Kamigotchi match your selected traits';
        resultsDiv.appendChild(noResultsDiv);
        isFiltering = false;
        return;
    }
    
    currentLoadIndex = 0;
    loadMoreNFTs();
    setupInfiniteScroll();
}

// NEW: Setup affinity filter toggle button
function setupAffinityFilterToggle() {
    const toggleBtn = document.getElementById('affinityFilterToggle');
    const affinitySection = document.querySelector('.affinity-filter-section');
    
    if (toggleBtn && affinitySection) {
        toggleBtn.addEventListener('click', () => {
            const isVisible = affinitySection.style.display !== 'none';
            affinitySection.style.display = isVisible ? 'none' : 'block';
            toggleBtn.classList.toggle('active', !isVisible);
        });
    }
}

// MODIFIED: Clicking affinity now toggles all matching individual trait checkboxes
function setupAffinityFilters() {
    const affinityButtons = document.querySelectorAll('.affinity-btn');
    
    affinityButtons.forEach(button => {
        button.addEventListener('click', () => {
            const affinityValue = button.textContent.trim();
            const isBody = button.closest('#bodyAffinity') !== null;
            const traitType = isBody ? 'body' : 'hand';
            const affinitySet = isBody ? selectedBodyAffinities : selectedHandAffinities;

            if (affinitySet.has(affinityValue)) {
                affinitySet.delete(affinityValue);
                button.classList.remove('active');
                toggleTraitCheckboxesByAffinity(traitType, affinityValue, false);
            } else {
                // --- FIX: CLEAR PREVIOUS SELECTIONS ---
                // 1. Clear the set for this category
                affinitySet.clear(); 
                
                // 2. Uncheck EVERY checkbox in the filterGroupsContainer for this type
                const allCheckboxesInType = document.querySelectorAll(`.trait-checkbox[data-trait-type="${traitType}"]`);
                allCheckboxesInType.forEach(cb => cb.checked = false);

                // 3. Set this affinity as active
                affinitySet.add(affinityValue);
                updateAffinityButtonStates(); 
                toggleTraitCheckboxesByAffinity(traitType, affinityValue, true);
            }
            
            // Re-run display logic to clear summary buttons and refresh results
            updateSelectedTraitsDisplay(true);
        });
    });
}

// NEW: Helper to sync checkboxes with the clicked affinity
function toggleTraitCheckboxesByAffinity(type, affinity, shouldCheck) {
    // Collect all traits that belong to this affinity from our data
    const affinityTraitNames = new Set();
    Object.values(traitsData).forEach(nft => {
        const trait = nft[type];
        if (trait && typeof trait === 'object' && trait.affinity === affinity) {
            affinityTraitNames.add(trait.name);
        }
    });

    // Toggle only the checkboxes for those specific traits
    affinityTraitNames.forEach(traitName => {
        const cb = document.querySelector(`.trait-checkbox[data-trait-type="${type}"][data-trait-value="${traitName}"]`);
        if (cb) cb.checked = shouldCheck;
    });
}

// NEW: Update affinity button visual states
function updateAffinityButtonStates() {
    const affinityButtons = document.querySelectorAll('.affinity-btn');
    
    affinityButtons.forEach(button => {
        const affinity = button.textContent.trim();
        const isBodyButton = button.closest('#bodyAffinity') !== null;
        
        if (isBodyButton) {
            button.classList.toggle('active', selectedBodyAffinities.has(affinity));
        } else {
            button.classList.toggle('active', selectedHandAffinities.has(affinity));
        }
    });
}

// NEW: Remove affinity filter when clicking on summary button
function removeSelectedAffinity(event) {
    const button = event.currentTarget;
    const affinityType = button.dataset.affinityType;
    const affinityValue = button.dataset.affinityValue;
    
    if (affinityType === 'body') {
        selectedBodyAffinities.delete(affinityValue);
    } else if (affinityType === 'hand') {
        selectedHandAffinities.delete(affinityValue);
    }
    
    updateAffinityButtonStates();
    filterByTraits();
    updateURL();
}

function setupMinMaxFilterToggle() {
    const toggleBtn = document.getElementById('minmaxFilterToggle');
    const minmaxSection = document.querySelector('.minmax-filter-section');
    
    if (toggleBtn && minmaxSection) {
        toggleBtn.addEventListener('click', () => {
            const isVisible = minmaxSection.style.display !== 'none';
            minmaxSection.style.display = isVisible ? 'none' : 'block';
            toggleBtn.classList.toggle('active', !isVisible);
        });
    }
}

// Helper: returns true if the stat min/max filters are at their default (no actual filtering)
function isStatFilterDefault(statName) {
    const f = statMinMaxFilters[statName];
    const slider = document.querySelector(`.stat-control.${statName} .stat-control-input`);
    if (!slider) return true;
    const defaultVal = Number(slider.min);
    // In min mode: at minimum value means "show all" (>= min = all pass)
    // In max mode: at maximum value means "show all" (<= max = all pass)
    if (f.isMax) {
        return f.value >= Number(slider.max);
    } else {
        return f.value <= defaultVal;
    }
}

// Helper: returns true if a kamigotchi passes all active stat min/max filters
function passesStatMinMaxFilters(id) {
    const kamiData = kamiStatsData[id];
    for (const [statName, filter] of Object.entries(statMinMaxFilters)) {
        if (isStatFilterDefault(statName)) continue;
        let statVal = 0;
        if (kamiData) {
            if (statName === 'slots') {
                statVal = kamiData.stats?.slots ?? 0;
            } else {
                statVal = kamiData.stats?.[statName] ?? 0;
            }
        }
        if (filter.isMax) {
            if (statVal > filter.value) return false;
        } else {
            if (statVal < filter.value) return false;
        }
    }
    return true;
}

// Helper: returns true if any stat filter is meaningfully active
function hasActiveStatFilters() {
    return Object.keys(statMinMaxFilters).some(s => !isStatFilterDefault(s));
}

const controls = document.querySelectorAll('.stat-control');

controls.forEach(control => {
  // Determine which stat this control is for
  const statName = ['health', 'power', 'violence', 'harmony', 'slots'].find(s => control.classList.contains(s));
  
  const slider = control.querySelector('input[type="range"]');
  const valueDisplay = control.querySelector('.stat-control-input-value');
  const toggleInput = control.querySelector('.toggle-input');

  // Initialize state from slider default
  if (statName && slider) {
    statMinMaxFilters[statName].value = Number(slider.value);
    statMinMaxFilters[statName].isMax = toggleInput ? toggleInput.checked : false;
  }

  // Update the text and state whenever the slider moves
  slider.addEventListener('input', (event) => {
    valueDisplay.textContent = event.target.value;
    if (statName) {
      statMinMaxFilters[statName].value = Number(event.target.value);
      triggerStatFilter();
    }
  });

  // Update state and re-filter when min/MAX toggle changes
  if (toggleInput && statName) {
    toggleInput.addEventListener('change', () => {
      statMinMaxFilters[statName].isMax = toggleInput.checked;
      // Update display (the value stays the same)
      triggerStatFilter();
    });
  }
});

function buildStatFilterSummaryHTML() {
    let html = '';
    Object.entries(statMinMaxFilters).forEach(([statName, filter]) => {
        if (isStatFilterDefault(statName)) return;
        const op = filter.isMax ? '&lt;=' : '&gt;=';
        html += `<button class="count-header-trait-btn stat-filter-summary-btn" 
                    data-stat-name="${statName}">
                    ${statName} ${op} ${filter.value} ×
                </button>`;
    });
    return html ? `<div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">${html}</div>` : '';
}

function attachStatFilterSummaryListeners(container) {
    container.querySelectorAll('.stat-filter-summary-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const statName = btn.dataset.statName;
            const slider = document.querySelector(`.stat-control.${statName} .stat-control-input`);
            const valueDisplay = document.querySelector(`.stat-control.${statName} .stat-control-input-value`);
            const toggleInput = document.querySelector(`.stat-control.${statName} .toggle-input`);
            if (slider) {
                slider.value = slider.min;
                if (valueDisplay) valueDisplay.textContent = slider.min;
            }
            // Reset toggle back to min mode
            if (toggleInput) toggleInput.checked = false;
            // Reset internal state fully
            statMinMaxFilters[statName].value = slider ? Number(slider.min) : 0;
            statMinMaxFilters[statName].isMax = false;
            triggerStatFilter();
        });
    });
}

// Trigger re-filter from stat sliders, integrating with existing filter logic
let _statFilterTimer = null;
function triggerStatFilter() {
    clearTimeout(_statFilterTimer);
    _statFilterTimer = setTimeout(() => {
        if (isShowingClonesOnly) {
            filterClones();
        } else if (isFiltering || hasActiveStatFilters()) {
            filterByTraits();
        } else {
            allNFTIds = getSortedNFTIds(Object.keys(traitsData));
            loadInitialNFTs();
        };
        updateURL();
    }, 200);
}


function clearFilters() {
    const checkboxes = document.querySelectorAll('.trait-checkbox');
    checkboxes.forEach(checkbox => checkbox.checked = false);
    
    const searchInputs = document.querySelectorAll('.trait-search');
    searchInputs.forEach(input => {
        input.value = '';
        const traitType = input.dataset.traitType;
        filterTraitOptions(traitType, '');
    });
    
    const dropdown = document.getElementById('traitCategoryDropdown');
    if (dropdown) dropdown.value = '';
    
    const allFilterGroups = document.querySelectorAll('.filter-group');
    allFilterGroups.forEach(group => group.style.display = 'none');

    // --- ADDED: RESET AFFINITY STATE ---
    selectedBodyAffinities.clear();
    selectedHandAffinities.clear();
    updateAffinityButtonStates(); // Resets the glowing/active state of buttons

    // --- ADDED: RESET STAT MIN/MAX FILTERS ---
    document.querySelectorAll('.stat-control').forEach(control => {
        const slider = control.querySelector('input[type="range"]');
        const valueDisplay = control.querySelector('.stat-control-input-value');
        const toggleInput = control.querySelector('.toggle-input');
        if (slider) {
            slider.value = slider.min;
            if (valueDisplay) valueDisplay.textContent = slider.min;
        }
        if (toggleInput) toggleInput.checked = false;
    });
    // Reset internal state
    Object.keys(statMinMaxFilters).forEach(statName => {
        const slider = document.querySelector(`.stat-control.${statName} .stat-control-input`);
        statMinMaxFilters[statName].value = slider ? Number(slider.min) : 0;
        statMinMaxFilters[statName].isMax = false;
    });
    
    isFiltering = false;
    filteredNFTIds = [];
    
    if (isShowingClonesOnly) {
        filterClones();
    } else {
        allNFTIds = getSortedNFTIds(Object.keys(traitsData));
        loadInitialNFTs();
    }
    
    updateURL();
}

// Setup refresh button
function setupRefreshButton() {
    const refreshBtn = document.getElementById('refreshDataBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshData);
    }
}

document.getElementById('searchBtn').addEventListener('click', searchByID);
document.getElementById('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchByID();
});
document.getElementById('clearSearchBtn').addEventListener('click', clearAllSelectedIDs);
document.getElementById('clearBtn').addEventListener('click', clearFilters);

function setupScrollToTop() {
    const scrollBtn = document.getElementById('scrollToTop');
    let lastScrollTop = 0;
    
    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll > 300) {
            if (currentScroll > lastScrollTop) {
                scrollBtn.classList.add('show');
            } else {
                scrollBtn.classList.remove('show');
            }
        } else {
            scrollBtn.classList.remove('show');
        }
        
        lastScrollTop = currentScroll;
    });
    
    scrollBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupScrollToTop();
    setupRefreshButton();
    // Add event listener for browser history changes
    window.addEventListener('popstate', handlePopState);

    document.addEventListener('click', (e) => {
        const filterControls = document.getElementById('filterControls');
        if (filterControls && !filterControls.contains(e.target)) {
            document.querySelectorAll('.filter-group').forEach(group => {
                group.style.display = 'none';
            });
            const dropdown = document.getElementById('traitCategoryDropdown');
            if (dropdown) dropdown.value = '';
        }
    });
});

// Inject enhanced styles for stats and badges
const enhancedStyles = `

/* Custom Message Box Style (For replacing alert()) */
#messageBox {
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: #f8d7da;
    color: #721c24;
    padding: 10px 20px;
    border: 1px solid #f5c6cb;
    border-radius: 5px;
    z-index: 1000;
    display: none;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}
`;

if (!document.getElementById('enhanced-trait-styles')) {
    const styleTag = document.createElement('style');
    styleTag.id = 'enhanced-trait-styles';
    styleTag.textContent = enhancedStyles;
    document.head.appendChild(styleTag);

    // Create a message box element (to replace alert)
    const messageBox = document.createElement('div');
    messageBox.id = 'messageBox';
    document.body.appendChild(messageBox);
}

// Clear any cached service workers on load
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (let registration of registrations) {
            registration.unregister();
        }
    });
}

loadData();