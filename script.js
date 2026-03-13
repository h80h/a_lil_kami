// BOT ARMOR — throttle duplicate requests to the database
let lastRequestTime = 0;


// ============================================================
// UMAMI ENGAGEMENT TRACKER
// ============================================================
(function () {
    try {
        const config = {
            id: 'd7d7ed00-7944-425f-8a8c-552bf9916cc0',
            domains: 'kami.h80h.xyz',
            host: 'https://kami.h80h.xyz/stats',
            src: '/stats/script.js',
        };

        const tiers = {
            'just-checking':    2000,
            'interested':       10000,
            'engaged':          30000,
            'deep-dive':        120000,
            'dedicated':        300000,
            'long-engagement':  600000,
        };

        if (window.location.hostname === 'localhost' || navigator.webdriver) return;

        const el = document.createElement('script');
        Object.assign(el, { src: config.src, defer: true });
        el.setAttribute('data-website-id', config.id);
        el.setAttribute('data-domains', config.domains);
        el.setAttribute('data-host-url', config.host);
        el.setAttribute('data-auto-track', 'false');
        document.head.appendChild(el);

        const getSessionVal = (key) => parseInt(sessionStorage.getItem(key) || '0');
        const setSessionVal = (key, val) => sessionStorage.setItem(key, val.toString());

        let engagementInterval;
        let pageViewSent = false;
        let lastEventTime = 0;
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
            history.pushState = function () {
                originalPush.apply(this, arguments);
                watchFilters();
            };

            document.addEventListener('visibilitychange', () => {
                if (window.umami && pageViewSent) {
                    umami.track(document.visibilityState === 'visible' ? 'tab-focus' : 'app-hidden');
                }
            });

            engagementInterval = setInterval(() => {
                const now = Date.now();
                const isGracePeriod = totalActiveTime < 600000;
                const hasRecentInteraction = (now - lastInteractionTimestamp) < 300000;

                if (document.visibilityState === 'visible' && (isGracePeriod || hasRecentInteraction)) {
                    totalActiveTime += 1000;
                    setSessionVal('kami_active_ms', totalActiveTime);

                    for (const [name, ms] of Object.entries(tiers)) {
                        const tierKey = 'kami_tier_' + name;
                        if (totalActiveTime >= ms && sessionStorage.getItem(tierKey) !== 'true') {
                            if (window.umami) {
                                if (!pageViewSent) {
                                    umami.track();
                                    pageViewSent = true;
                                    if (window.location.search) watchFilters(true);
                                }
                                umami.track(name, { seconds: ms / 1000 });
                                sessionStorage.setItem(tierKey, 'true');
                                lastEventTime = totalActiveTime;
                            }
                        }
                    }

                    if (totalActiveTime >= 600000 && (totalActiveTime - lastEventTime >= 240000)) {
                        if (window.umami && heartbeatCount < MAX_HEARTBEATS && hasRecentInteraction) {
                            umami.track('heartbeat');
                            heartbeatCount++;
                            setSessionVal('kami_hb_count', heartbeatCount);
                            lastEventTime = totalActiveTime;
                        }
                    }
                }
            }, 1000);
        };
    } catch (e) {}
})();


// ============================================================
// LIVE STATUS (online user counter)
// ============================================================
async function updateLiveStatus() {
    const now = Date.now();
    if (now - lastRequestTime < 10000) return;
    lastRequestTime = now;

    try {
        const response = await fetch(`/api/heartbeat?t=${now}`);
        if (!response.ok) throw new Error('Network error');

        const data = await response.json();
        const rawCount = data.count || 0;
        const countElement = document.getElementById('online-count');

        if (countElement) {
            const displayCount = rawCount > 0 ? rawCount : 1;
            countElement.innerText = displayCount;
            countElement.classList.add('visible');

            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            const statusColor = rawCount > 0 ? '#22c55e' : '#999';
            console.log(
                `%c● %cLive Status %c[%s]%c %c${rawCount} Online %c(UI: ${displayCount})`,
                `color: ${statusColor}; font-size: 14px;`,
                'color: #bbb;',
                'color: #666; font-family: monospace;',
                time,
                'color: #bbb;',
                `color: ${statusColor};`,
                'color: #555; font-size: 10px; font-style: italic;'
            );
        }
    } catch (err) {
        console.error('%c[!] Live Sync Interrupted.', 'color: #ef4444;');
    }
}


// ============================================================
// GLOBAL STATE
// ============================================================

let imagesData = {};
let traitsData = {};
let kamiStatsData = {};
let kamiInfoData = {};     // { [kamiIndex]: { name, level, stats: { harmony, health, power, violence } } }
let kamiAccountsData = {}; // { [accountIndex]: { name, ownerAddress, kamis: [indices] } }
let kamiToAccount = {};    // { [kamiIndex]: { accountIndex, accountName } }  — built after load
let affinityData = {};
let metadataInfo = {};
let sacrificedNFTs = new Set();
let listingNFTs = new Map();
let listingMetaInfo = { newListingId: [], listingNewWindow: {} };

let cachedListingsHash = null;
let cachedListingsMetaHash = null;
let cachedMetaHash = null;

let traitSignatures = {};
let traitAffinityLookup = {};
let traitCounts = {};
let nftRarityScores = {};

let allNFTIds = [];
let filteredNFTIds = [];
let selectedIDs = new Set();
let currentLoadIndex = 0;
let currentSortOrder = 'latest';
let currentListingSortOrder = null;
let isFiltering = false;
let isLoading = false;
let isRefreshing = false;
let nftObserver = null;

let isShowingClonesOnly = false;
let isShowingListingOnly = false;
let selectedBodyAffinities = new Set();
let selectedHandAffinities = new Set();

let statMinMaxFilters = {
    health:   { value: 50, isMax: false },
    power:    { value: 10, isMax: false },
    violence: { value: 10, isMax: false },
    harmony:  { value: 10, isMax: false },
    slots:    { value: 0,  isMax: false },
};

const INITIAL_LOAD_COUNT = 50;
const LAZY_LOAD_COUNT = 30;

let isMobile = window.innerWidth <= 390;
window.addEventListener('resize', () => { isMobile = window.innerWidth <= 390; }, { passive: true });


// ============================================================
// URL SYNCHRONIZATION
// ============================================================

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
            if (traitData && affinitySet.has(traitData.affinity)) isCoveredByAffinity = true;
        }

        if (!isCoveredByAffinity) {
            if (!selected[type]) selected[type] = [];
            selected[type].push(encodeURIComponent(value));
        }
    });

    return Object.entries(selected).map(([type, values]) => `${type}:${values.join(',')}`).join(';');
}

function getAffinityStringFromState() {
    const parts = [];
    if (selectedBodyAffinities.size > 0) parts.push(`body:${Array.from(selectedBodyAffinities).join(',')}`);
    if (selectedHandAffinities.size > 0) parts.push(`hand:${Array.from(selectedHandAffinities).join(',')}`);
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

function updateURL(replace = false) {
    const params = new URLSearchParams();
    if (currentSortOrder && currentSortOrder !== 'latest') params.set('sort', currentSortOrder);

    const traitString = getTraitStringFromState();
    if (traitString) params.set('traits', traitString);

    const idArray = Array.from(selectedIDs).sort((a, b) => Number(a) - Number(b));
    if (idArray.length > 0) params.set('ids', idArray.join(','));

    if (isShowingClonesOnly) params.set('clones', 'true');
    if (isShowingListingOnly) {
        params.set('listing', 'true');
        if (currentListingSortOrder) params.set('listing-sort', currentListingSortOrder);
    }

    const affinityString = getAffinityStringFromState();
    if (affinityString) params.set('affinity', affinityString);

    const minMaxString = getMinMaxStringFromState();
    if (minMaxString) params.set('minmax', minMaxString);

    const queryString = params.toString();
    const newUrl = queryString
        ? `${window.location.pathname}?${queryString}${window.location.hash}`
        : `${window.location.pathname}${window.location.hash}`;

    if (replace) history.replaceState(null, '', newUrl);
    else         history.pushState(null, '', newUrl);
}

function loadStateFromURL({ restorePanels = true } = {}) {
    const params = new URLSearchParams(window.location.search);
    let hasFilters = false;

    const urlSort = params.get('sort');
    if (urlSort) currentSortOrder = urlSort;

    const urlIDs = params.get('ids');
    if (urlIDs) selectedIDs = new Set(urlIDs.split(',').map(id => id.trim()).filter(Boolean));

    isShowingClonesOnly  = params.get('clones') === 'true';
    isShowingListingOnly = params.get('listing') === 'true';

    const urlListingSort = params.get('listing-sort');
    currentListingSortOrder = (isShowingListingOnly && urlListingSort) ? urlListingSort : null;

    const urlTraits = params.get('traits');
    if (urlTraits) {
        urlTraits.split(';').forEach(group => {
            const [type, valuesString] = group.split(':');
            if (type && valuesString) {
                valuesString.split(',').map(v => decodeURIComponent(v)).forEach(value => {
                    const checkbox = document.querySelector(`.trait-checkbox[data-trait-type="${type}"][data-trait-value="${value}"]`);
                    if (checkbox) { checkbox.checked = true; hasFilters = true; }
                });
            }
        });
    }

    const urlAffinity = params.get('affinity');
    if (urlAffinity) {
        urlAffinity.split(';').forEach(group => {
            const [type, valuesString] = group.split(':');
            if (type && valuesString) {
                valuesString.split(',').forEach(affinityValue => {
                    if (type === 'body') selectedBodyAffinities.add(affinityValue);
                    else if (type === 'hand') selectedHandAffinities.add(affinityValue);

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

        if (restorePanels) {
            const affinitySection = document.querySelector('.affinity-filter-section');
            const toggleBtn = document.getElementById('affinityFilterToggle');
            if (affinitySection) affinitySection.style.display = 'block';
            if (toggleBtn) toggleBtn.classList.add('active');
        }
        updateAffinityButtonStates();
    }

    const urlMinMax = params.get('minmax');
    if (urlMinMax) {
        urlMinMax.split(';').forEach(part => {
            const [statName, value, mode] = part.split(':');
            if (statName && value && statMinMaxFilters[statName] !== undefined) {
                const isMax = mode === 'max';
                statMinMaxFilters[statName].value = Number(value);
                statMinMaxFilters[statName].isMax = isMax;

                const slider       = document.querySelector(`.stat-control.${statName} .stat-control-input`);
                const valueDisplay = document.querySelector(`.stat-control.${statName} .stat-control-input-value`);
                const toggleInput  = document.querySelector(`.stat-control.${statName} .toggle-input`);
                if (slider)       slider.value = value;
                if (valueDisplay) valueDisplay.textContent = value;
                if (toggleInput)  toggleInput.checked = isMax;
            }
        });

        if (restorePanels) {
            const minmaxSection = document.querySelector('.minmax-filter-section');
            const toggleBtn = document.getElementById('minmaxFilterToggle');
            if (minmaxSection) minmaxSection.style.display = 'block';
            if (toggleBtn) toggleBtn.classList.add('active');
        }
        hasFilters = true;
    }

    return hasFilters;
}

function handlePopState() {
    const hasFilters = loadStateFromURL();

    updateSelectedIDsDisplay();
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    if (!currentListingSortOrder) {
        document.querySelector(`.sort-btn[data-sort="${currentSortOrder}"]`)?.classList.add('active');
    }

    document.querySelectorAll('.listing-sort-btn').forEach(b => b.classList.remove('active'));
    if (currentListingSortOrder) {
        document.querySelector(`.listing-sort-btn[listing-data-sort="${currentListingSortOrder}"]`)?.classList.add('active');
    }

    document.getElementById('cloneFilterBtn')?.classList.toggle('active', isShowingClonesOnly);
    document.getElementById('listingFilterBtn')?.classList.toggle('active', isShowingListingOnly);

    if (isShowingClonesOnly)       filterClones();
    else if (isShowingListingOnly) filterListing();
    else if (hasFilters)           filterByTraits();
    else { isFiltering = false; allNFTIds = getSortedNFTIds(); loadInitialNFTs(); }
}


// ============================================================
// LOADER / CONTAINER DISPLAY
// ============================================================

function showLoader() {
    const loader = document.querySelector('.loader');
    loader.style.display = 'block';
    loader.style.opacity = '1';
}

function hideLoader() {
    const loader = document.querySelector('.loader');
    loader.style.opacity = '0';
    if (typeof window.startHonestTracking === 'function') window.startHonestTracking();
    setTimeout(() => { updateLiveStatus(); loader.style.display = 'none'; }, 300);
    if (!window.liveStatusInterval) window.liveStatusInterval = setInterval(updateLiveStatus, 60000);
}

function showContainer() {
    const container = document.querySelector('.container');
    container.style.display = 'block';
    setTimeout(() => { container.style.opacity = '1'; }, 50);
}


// ============================================================
// DATA HELPERS
// ============================================================

function getTraitName(traitData) {
    return typeof traitData === 'string' ? traitData : traitData.name;
}

function createTraitSignature(traits) {
    return Object.keys(traits).sort()
        .map(category => `${category}:${getTraitName(traits[category])}`)
        .join('|');
}

function buildTraitSignatures() {
    const signatures = {};
    const groups = {};

    Object.entries(traitsData).forEach(([id, traits]) => {
        const sig = createTraitSignature(traits);
        signatures[id] = sig;
        if (!groups[sig]) groups[sig] = [];
        groups[sig].push(id);
    });

    const cloneIds = new Set();
    Object.values(groups).forEach(ids => {
        if (ids.length > 1) ids.forEach(id => cloneIds.add(id));
    });

    return { signatures, groups, cloneIds };
}

function calculateTraitCounts() {
    const counts = {};
    Object.values(traitsData).forEach(nft => {
        Object.entries(nft).forEach(([category, traitData]) => {
            const traitName = getTraitName(traitData);
            if (!counts[category]) counts[category] = {};
            counts[category][traitName] = (counts[category][traitName] || 0) + 1;
        });
    });
    return counts;
}

// OpenRarity — information content scoring (score = I(x) / E[I(x)])
// See: https://openrarity.gitbook.io/developers/fundamentals/methodology
function calculateRarityScores() {
    const totalNFTs = Object.keys(traitsData).length;
    const scores = {};

    const traitIC = {};
    Object.entries(traitCounts).forEach(([category, traits]) => {
        traitIC[category] = {};
        Object.entries(traits).forEach(([traitName, count]) => {
            traitIC[category][traitName] = -Math.log2(count / totalNFTs);
        });
    });

    Object.entries(traitsData).forEach(([id, traits]) => {
        let ix = 0;
        Object.entries(traits).forEach(([category, traitData]) => {
            ix += traitIC[category][getTraitName(traitData)];
        });
        scores[id] = ix;
    });

    const expectedIx = Object.values(scores).reduce((sum, ix) => sum + ix, 0) / totalNFTs;
    Object.keys(scores).forEach(id => { scores[id] = scores[id] / expectedIx; });

    const sortedByScore = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const rankedScores = {};
    let currentRank = 1;
    let previousScore = null;
    let tieCount = 0;

    sortedByScore.forEach(([id, score], index) => {
        if (previousScore !== null && score !== previousScore) {
            currentRank = index + 1;
            tieCount = 0;
        } else if (previousScore === score) {
            tieCount++;
        }
        rankedScores[id] = {
            score,
            rank: currentRank,
            isTied: tieCount > 0 || (index < sortedByScore.length - 1 && sortedByScore[index + 1][1] === score),
        };
        previousScore = score;
    });

    return rankedScores;
}

function buildTraitAffinityLookup() {
    const lookup = { body: {}, hand: {} };
    Object.values(traitsData).forEach(nft => {
        ['body', 'hand'].forEach(type => {
            const trait = nft[type];
            if (trait && typeof trait === 'object' && trait.name && trait.affinity) {
                lookup[type][trait.name] = trait.affinity;
            }
        });
    });
    return lookup;
}

function extractAffinityData() {
    const affinities = {};
    Object.entries(traitsData).forEach(([id, traits]) => {
        affinities[id] = {
            body: (traits.body && typeof traits.body === 'object' && traits.body.affinity) ? traits.body.affinity : 'NORMAL',
            hand: (traits.hand && typeof traits.hand === 'object' && traits.hand.affinity) ? traits.hand.affinity : 'NORMAL',
        };
    });
    return affinities;
}


// ============================================================
// SORTING
// ============================================================

function getSortedNFTIds(idsToSort) {
    const ids = idsToSort || Object.keys(traitsData);

    const getStatValue = (id) => {
        switch (currentSortOrder) {
            case 'rarity':   return nftRarityScores[id]?.rank || 9999;
            case 'harmony':  return kamiStatsData[id]?.stats.harmony || 0;
            case 'health':   return kamiStatsData[id]?.stats.health || 0;
            case 'power':    return kamiStatsData[id]?.stats.power || 0;
            case 'violence': return kamiStatsData[id]?.stats.violence || 0;
            default:         return 0;
        }
    };

    if (currentSortOrder === 'latest' || currentSortOrder === 'oldest') {
        if (isShowingClonesOnly) {
            const repId = {};
            ids.forEach(id => {
                const sig = traitSignatures.signatures[id];
                const num = Number(id);
                if (!repId[sig]) {
                    repId[sig] = num;
                } else {
                    repId[sig] = currentSortOrder === 'latest'
                        ? Math.max(repId[sig], num)
                        : Math.min(repId[sig], num);
                }
            });
            return ids.sort((a, b) => {
                const sigA = traitSignatures.signatures[a];
                const sigB = traitSignatures.signatures[b];
                if (sigA !== sigB) {
                    return currentSortOrder === 'latest' ? repId[sigB] - repId[sigA] : repId[sigA] - repId[sigB];
                }
                return currentSortOrder === 'latest' ? Number(b) - Number(a) : Number(a) - Number(b);
            });
        }
        return ids.sort((a, b) =>
            currentSortOrder === 'latest' ? Number(b) - Number(a) : Number(a) - Number(b)
        );
    }

    return ids.sort((a, b) => {
        const sigA = traitSignatures.signatures[a];
        const sigB = traitSignatures.signatures[b];

        if (sigA !== sigB) {
            const statA = getStatValue(a);
            const statB = getStatValue(b);
            if (statA !== statB) return currentSortOrder === 'rarity' ? statA - statB : statB - statA;
            const repA = Math.max(...traitSignatures.groups[sigA].map(Number));
            const repB = Math.max(...traitSignatures.groups[sigB].map(Number));
            return repB - repA;
        }

        return Number(b) - Number(a);
    });
}

function getSortedListingIds(ids) {
    // If no ids provided, return empty array immediately
    if (!ids || ids.length === 0) return [];

    // Use the array directly instead of spreading [...ids] 
    // since we pass a new array from updateSelectedIDsDisplay
    return ids.sort((a, b) => {
        const itemA = listingNFTs.get(String(a));
        const itemB = listingNFTs.get(String(b));

        // Sorting by Price
        if (currentListingSortOrder === 'price') {
            const priceA = itemA?.price ?? Infinity;
            const priceB = itemB?.price ?? Infinity;
            
            if (priceA !== priceB) return priceA - priceB;
            
            // Secondary sort: Most recent if prices are tied
            const tsA = Number(itemA?.timestamp ?? 0);
            const tsB = Number(itemB?.timestamp ?? 0);
            return tsB - tsA;
        } 
        
        // Sorting by Recent
        if (currentListingSortOrder === 'recent') {
            const tsA = Number(itemA?.timestamp ?? 0);
            const tsB = Number(itemB?.timestamp ?? 0);
            
            if (tsA !== tsB) return tsB - tsA;
            
            // Secondary sort: Cheaper if timestamps are tied
            const priceA = itemA?.price ?? Infinity;
            const priceB = itemB?.price ?? Infinity;
            return priceA - priceB;
        }

        // Default: Sort by ID descending
        return Number(b) - Number(a);
    });
}


// ============================================================
// FILTER HELPERS
// ============================================================

function isStatFilterDefault(statName) {
    const f = statMinMaxFilters[statName];
    const slider = document.querySelector(`.stat-control.${statName} .stat-control-input`);
    if (!slider) return true;
    return f.isMax ? f.value >= Number(slider.max) : f.value <= Number(slider.min);
}

function hasActiveStatFilters() {
    return Object.keys(statMinMaxFilters).some(s => !isStatFilterDefault(s));
}

function passesStatMinMaxFilters(id) {
    const kamiData = kamiStatsData[id];
    for (const [statName, filter] of Object.entries(statMinMaxFilters)) {
        if (isStatFilterDefault(statName)) continue;
        const statVal = kamiData ? (kamiData.stats?.[statName] ?? 0) : 0;
        if (filter.isMax ? statVal > filter.value : statVal < filter.value) return false;
    }
    return true;
}

// Returns { traitType: [values] } for all currently checked trait checkboxes
function getSelectedTraitsFromCheckboxes() {
    const selectedTraits = {};
    document.querySelectorAll('.trait-checkbox:checked').forEach(cb => {
        const type = cb.dataset.traitType;
        if (!selectedTraits[type]) selectedTraits[type] = [];
        selectedTraits[type].push(cb.dataset.traitValue);
    });
    return selectedTraits;
}

// Returns true if the NFT matches all entries in a selectedTraits map
function matchesSelectedTraits(id, selectedTraits) {
    const nftTraits = traitsData[id];
    return Object.entries(selectedTraits).every(([traitType, selectedValues]) =>
        selectedValues.includes(getTraitName(nftTraits[traitType]))
    );
}

const AFFINITY_MAP = { NORMAL: 'N', INSECT: 'I', SCRAP: 'S', EERIE: 'E' };

function getAffinityNotation() {
    if (selectedBodyAffinities.size === 0 && selectedHandAffinities.size === 0) return '';
    const bChar = AFFINITY_MAP[Array.from(selectedBodyAffinities)[0]] || '';
    const hChar = AFFINITY_MAP[Array.from(selectedHandAffinities)[0]] || '';
    return ` (${bChar}/${hChar})`;
}

function buildTraitSummaryButtonsHTML(selectedTraits) {
    return Object.entries(selectedTraits).flatMap(([type, values]) =>
        values.map(value => `
            <button class="count-header-trait-btn" data-trait-type="${type}" data-trait-value="${value}"
                    title="Click to remove filter: ${type}: ${value}">
                ${type}: ${value} ×
            </button>`)
    ).join('');
}

function buildStatFilterSummaryHTML() {
    let html = '';
    Object.entries(statMinMaxFilters).forEach(([statName, filter]) => {
        if (isStatFilterDefault(statName)) return;
        const op = filter.isMax ? '&lt;=' : '&gt;=';
        html += `<button class="count-header-trait-btn stat-filter-summary-btn" data-stat-name="${statName}">
                    ${statName} ${op} ${filter.value} ×
                 </button>`;
    });
    return html
        ? `<div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">${html}</div>`
        : '';
}

function attachStatFilterSummaryListeners(container) {
    container.querySelectorAll('.stat-filter-summary-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const statName = btn.dataset.statName;
            const slider       = document.querySelector(`.stat-control.${statName} .stat-control-input`);
            const valueDisplay = document.querySelector(`.stat-control.${statName} .stat-control-input-value`);
            const toggleInput  = document.querySelector(`.stat-control.${statName} .toggle-input`);
            if (slider) {
                slider.value = slider.min;
                if (valueDisplay) valueDisplay.textContent = slider.min;
            }
            if (toggleInput) toggleInput.checked = false;
            statMinMaxFilters[statName].value = slider ? Number(slider.min) : 0;
            statMinMaxFilters[statName].isMax = false;
            triggerStatFilter();
        });
    });
}

function appendCountHeader(resultsDiv, summaryText, filterSummaryHTML = '') {
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    countDiv.innerHTML = `
        <div id="count-summary" style="font-size: 14px;">${summaryText}</div>
        <div class="note">** click the lil arrow on card for og stats and more info **</div>
        ${filterSummaryHTML}
        ${buildStatFilterSummaryHTML()}
    `;
    resultsDiv.appendChild(countDiv);
    attachStatFilterSummaryListeners(countDiv);
    countDiv.querySelectorAll('.count-header-trait-btn:not(.stat-filter-summary-btn)').forEach(btn => {
        btn.addEventListener('click', removeSelectedTrait);
    });
    return countDiv;
}

function restoreViewAfterToggle() {
    const hasAffinityFilters = selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;
    if (isFiltering || hasAffinityFilters) preserveScroll(() => { filterByTraits(); updateURL(); });
    else                                   preserveScroll(() => { allNFTIds = getSortedNFTIds(); loadInitialNFTs(); updateURL(); });
}


// ============================================================
// SETUP — SORT & FILTER BUTTON WIRING
// ============================================================

function setupSortButtons() {
    const sortButtons = document.querySelectorAll('.sort-btn');
    sortButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const newSort = e.target.dataset.sort;
            if (newSort === currentSortOrder && currentListingSortOrder === null) return;

            if (currentListingSortOrder !== null) {
                currentListingSortOrder = null;
                document.querySelectorAll('.listing-sort-btn').forEach(b => b.classList.remove('active'));
            }

            currentSortOrder = newSort;
            sortButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            if (isShowingClonesOnly && !(isShowingListingOnly && currentListingSortOrder)) preserveScroll(() => filterClones());
            else if (isShowingListingOnly) preserveScroll(() => filterListing());
            else if (isFiltering)          preserveScroll(() => filterByTraits());
            else                           preserveScroll(() => { allNFTIds = getSortedNFTIds(); loadInitialNFTs(); });

            if (selectedIDs.size > 0) updateSelectedIDsDisplay();
            updateURL();
        });
    });
}

function setupCloneFilterButton() {
    const cloneBtn = document.getElementById('cloneFilterBtn');
    if (!cloneBtn) return;

    cloneBtn.addEventListener('click', () => {
        isShowingClonesOnly = !isShowingClonesOnly;
        cloneBtn.classList.toggle('active', isShowingClonesOnly);

        if (isShowingClonesOnly)           preserveScroll(() => { filterClones(); updateURL(); });
        else if (isShowingListingOnly)     preserveScroll(() => { filterListing(); updateURL(); });
        else                               restoreViewAfterToggle();
    });
}

function setupListingFilterButton() {
    const listingBtn = document.getElementById('listingFilterBtn');
    if (!listingBtn) return;

    listingBtn.addEventListener('click', () => {
        isShowingListingOnly = !isShowingListingOnly;
        listingBtn.classList.toggle('active', isShowingListingOnly);

        const listingSortSection = document.querySelector('.listing-sort-section');
        if (listingSortSection) listingSortSection.style.display = isShowingListingOnly ? 'block' : 'none';

        if (!isShowingListingOnly) {
            currentListingSortOrder = null;
            document.querySelectorAll('.listing-sort-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            document.querySelector(`.sort-btn[data-sort="${currentSortOrder}"]`)?.classList.add('active');
        }

        if (isShowingListingOnly)          preserveScroll(() => { filterListing(); updateURL(); });
        else if (isShowingClonesOnly)      preserveScroll(() => { filterClones(); updateURL(); });
        else                               restoreViewAfterToggle();

        if (selectedIDs.size > 0) updateSelectedIDsDisplay();
    });
}

function setupListingSortButtons() {
    const listingSortBtns = document.querySelectorAll('.listing-sort-btn');
    listingSortBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (!isShowingListingOnly) return;

            const newListingSort = btn.getAttribute('listing-data-sort');
            if (newListingSort === currentListingSortOrder) return;

            listingSortBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentListingSortOrder = newListingSort;

            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            currentSortOrder = 'latest';

            preserveScroll(() => { filterListing(); updateURL(); });

            if (selectedIDs.size > 0) updateSelectedIDsDisplay();
        });
    });
}

function setupAffinityFilterToggle() {
    const toggleBtn = document.getElementById('affinityFilterToggle');
    const affinitySection = document.querySelector('.affinity-filter-section');
    if (!toggleBtn || !affinitySection) return;

    toggleBtn.addEventListener('click', () => {
        const isVisible = affinitySection.style.display !== 'none';
        affinitySection.style.display = isVisible ? 'none' : 'block';
        toggleBtn.classList.toggle('active', !isVisible);
    });
}

function setupMinMaxFilterToggle() {
    const toggleBtn = document.getElementById('minmaxFilterToggle');
    const minmaxSection = document.querySelector('.minmax-filter-section');
    if (!toggleBtn || !minmaxSection) return;

    toggleBtn.addEventListener('click', () => {
        const isVisible = minmaxSection.style.display !== 'none';
        minmaxSection.style.display = isVisible ? 'none' : 'block';
        toggleBtn.classList.toggle('active', !isVisible);
    });
}

function setupAffinityFilters() {
    document.querySelectorAll('.affinity-btn').forEach(button => {
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
                affinitySet.clear();
                document.querySelectorAll(`.trait-checkbox[data-trait-type="${traitType}"]`).forEach(cb => cb.checked = false);
                affinitySet.add(affinityValue);
                updateAffinityButtonStates();
                toggleTraitCheckboxesByAffinity(traitType, affinityValue, true);
            }

            updateSelectedTraitsDisplay(true);
        });
    });
}

function toggleTraitCheckboxesByAffinity(type, affinity, shouldCheck) {
    const lookup = traitAffinityLookup[type] || {};
    Object.entries(lookup).forEach(([traitName, aff]) => {
        if (aff !== affinity) return;
        const cb = document.querySelector(`.trait-checkbox[data-trait-type="${type}"][data-trait-value="${traitName}"]`);
        if (cb) cb.checked = shouldCheck;
    });
}

function updateAffinityButtonStates() {
    document.querySelectorAll('.affinity-btn').forEach(button => {
        const affinity = button.textContent.trim();
        const isBodyButton = button.closest('#bodyAffinity') !== null;
        button.classList.toggle('active', isBodyButton
            ? selectedBodyAffinities.has(affinity)
            : selectedHandAffinities.has(affinity)
        );
    });
}

function removeSelectedAffinity(event) {
    const { affinityType, affinityValue } = event.currentTarget.dataset;
    if (affinityType === 'body') selectedBodyAffinities.delete(affinityValue);
    else if (affinityType === 'hand') selectedHandAffinities.delete(affinityValue);
    updateAffinityButtonStates();
    if (isShowingListingOnly) preserveScroll(() => { filterListing(); updateURL(); });
    else                      preserveScroll(() => { filterByTraits(); updateURL(); });
}

function validateAffinitiesAgainstCheckboxes() {
    let stateChanged = false;

    ['body', 'hand'].forEach(type => {
        const activeAffinities = type === 'body' ? selectedBodyAffinities : selectedHandAffinities;
        const lookup = traitAffinityLookup[type] || {};

        const checkedTraitNames = Array.from(
            document.querySelectorAll(`.trait-checkbox[data-trait-type="${type}"]:checked`)
        ).map(cb => cb.dataset.traitValue);

        const representedAffinities = new Set(
            checkedTraitNames.map(name => lookup[name]).filter(Boolean)
        );

        if (representedAffinities.size === 1) {
            const currentAffinity = Array.from(representedAffinities)[0];
            const requiredTraits = Object.entries(lookup)
                .filter(([, aff]) => aff === currentAffinity)
                .map(([name]) => name);
            const checkedSet = new Set(checkedTraitNames);
            const isComplete = requiredTraits.every(name => checkedSet.has(name));

            if (isComplete && !activeAffinities.has(currentAffinity)) {
                activeAffinities.add(currentAffinity);
                stateChanged = true;
            } else if (!isComplete && activeAffinities.size > 0) {
                activeAffinities.clear();
                stateChanged = true;
            }
        } else if (activeAffinities.size > 0) {
            activeAffinities.clear();
            stateChanged = true;
        }
    });

    if (stateChanged) updateAffinityButtonStates();
}

// Wires up stat slider + min/max toggle controls
const controls = document.querySelectorAll('.stat-control');
controls.forEach(control => {
    const statName = ['health', 'power', 'violence', 'harmony', 'slots'].find(s => control.classList.contains(s));
    const slider       = control.querySelector('input[type="range"]');
    const valueDisplay = control.querySelector('.stat-control-input-value');
    const toggleInput  = control.querySelector('.toggle-input');

    if (statName && slider) {
        statMinMaxFilters[statName].value = Number(slider.value);
        statMinMaxFilters[statName].isMax = toggleInput ? toggleInput.checked : false;
    }

    slider.addEventListener('input', (event) => {
        valueDisplay.textContent = event.target.value;
        if (statName) {
            statMinMaxFilters[statName].value = Number(event.target.value);
            triggerStatFilter();
        }
    });

    if (toggleInput && statName) {
        toggleInput.addEventListener('change', () => {
            statMinMaxFilters[statName].isMax = toggleInput.checked;
            triggerStatFilter();
        });
    }
});

let _statFilterTimer = null;
function triggerStatFilter() {
    clearTimeout(_statFilterTimer);
    _statFilterTimer = setTimeout(() => {
        preserveScroll(() => {
            if (isShowingClonesOnly && !(isShowingListingOnly && currentListingSortOrder)) filterClones();
            else if (isShowingListingOnly)              filterListing();
            else if (isFiltering || hasActiveStatFilters()) filterByTraits();
            else { allNFTIds = getSortedNFTIds(Object.keys(traitsData)); loadInitialNFTs(); }
            updateURL();
        });
    }, 200);
}

function preserveScroll(fn) {
    const scrollY = window.scrollY;
    fn();
    requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
}


// ============================================================
// FILTER CONTROLS UI
// ============================================================

function createFilterControls() {
    const filterControls = document.getElementById('filterControls');
    const allTraits = {};
    const traitDetails = {};

    Object.values(traitsData).forEach(nft => {
        Object.entries(nft).forEach(([traitType, traitData]) => {
            if (!allTraits[traitType]) { allTraits[traitType] = new Set(); traitDetails[traitType] = {}; }
            const traitName = getTraitName(traitData);
            allTraits[traitType].add(traitName);
            if (typeof traitData === 'object' && traitData.name && !traitDetails[traitType][traitName]) {
                traitDetails[traitType][traitName] = {
                    affinity: traitData.affinity || null,
                    stats: traitData.stats || {},
                };
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

    const totalNFTs = Object.keys(traitsData).length;

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

        const sortedValues = [...allTraits[traitType]].sort((a, b) =>
            (traitCounts[traitType][a] || 0) - (traitCounts[traitType][b] || 0)
        );

        sortedValues.forEach(value => {
            const count = traitCounts[traitType][value] || 0;
            const percentage = ((count / totalNFTs) * 100).toFixed(1);
            const details = traitDetails[traitType][value] || {};

            const affinityHTML = (details.affinity && (traitType === 'body' || traitType === 'hand'))
                ? `<span class="trait-affinity ${details.affinity}">${details.affinity}</span>`
                : '';

            let statsHTML = '';
            if (details.stats && Object.keys(details.stats).length > 0) {
                const statBadges = Object.entries(details.stats).map(([statName, val]) => {
                    const sign = val > 0 ? '+' : '';
                    return `<span class="trait-stat ${statName}">${statName.slice(0, 3).toUpperCase()} ${sign}${val}</span>`;
                }).join('');
                statsHTML = `<span class="trait-stats">${statBadges}</span>`;
            }

            const checkboxWrapper = document.createElement('label');
            checkboxWrapper.className = 'checkbox-label';
            checkboxWrapper.dataset.traitValue = value.toLowerCase();

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'trait-checkbox';
            checkbox.dataset.traitType = traitType;
            checkbox.dataset.traitValue = value;
            checkbox.addEventListener('change', () => updateSelectedTraitsDisplay(false));

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

        searchInput.addEventListener('input', (e) => filterTraitOptions(traitType, e.target.value));
    });

    dropdown.addEventListener('change', (e) => {
        document.querySelectorAll('.filter-group').forEach(group => group.style.display = 'none');
        if (e.target.value) {
            const selectedGroup = document.querySelector(`.filter-group[data-trait-type="${e.target.value}"]`);
            if (selectedGroup) selectedGroup.style.display = 'block';
        }
    });
}

function filterTraitOptions(traitType, searchTerm) {
    const container = document.querySelector(`.checkbox-container[data-trait-type="${traitType}"]`);
    const searchLower = searchTerm.toLowerCase().trim();
    let visibleCount = 0;

    container.querySelectorAll('.checkbox-label').forEach(label => {
        const matches = searchLower === '' || label.dataset.traitValue.includes(searchLower);
        label.style.display = matches ? 'flex' : 'none';
        if (matches) visibleCount++;
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
        noResultsMsg?.remove();
    }
}


// ============================================================
// FILTER ACTIONS
// ============================================================

function filterClones() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.textContent = '';

    const selectedTraits = getSelectedTraitsFromCheckboxes();
    const hasTraitFilters   = Object.keys(selectedTraits).length > 0;
    const hasAffinityFilters = selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;

    let cloneIds = hasTraitFilters
        ? Array.from(traitSignatures.cloneIds).filter(id => matchesSelectedTraits(id, selectedTraits))
        : Array.from(traitSignatures.cloneIds);

    if (hasAffinityFilters) {
        cloneIds = cloneIds.filter(id => {
            const a = affinityData[id];
            return a
                && (selectedBodyAffinities.size === 0 || selectedBodyAffinities.has(a.body))
                && (selectedHandAffinities.size === 0 || selectedHandAffinities.has(a.hand));
        });
    }
    if (hasActiveStatFilters()) cloneIds = cloneIds.filter(id => passesStatMinMaxFilters(id));
    if (isShowingListingOnly)   cloneIds = cloneIds.filter(id => listingNFTs.has(String(id)));

    filteredNFTIds = (isShowingListingOnly && currentListingSortOrder)
        ? getSortedListingIds(cloneIds)
        : getSortedNFTIds(cloneIds);
    isFiltering = true;

    const uniqueSignatures = new Set(cloneIds.map(id => traitSignatures.signatures[id]));
    const filterSummaryHTML = hasTraitFilters
        ? `<div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">${buildTraitSummaryButtonsHTML(selectedTraits)}</div>`
        : '';

    appendCountHeader(
        resultsDiv,
        `Found ${cloneIds.length} clones in ${uniqueSignatures.size} groups${getAffinityNotation()}`,
        filterSummaryHTML
    );

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

function filterListing() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.textContent = '';

    const selectedTraits = getSelectedTraitsFromCheckboxes();
    const hasTraitFilters   = Object.keys(selectedTraits).length > 0;
    const hasAffinityFilters = selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;

    let listingIds;
    if (isShowingClonesOnly) {
        const cloneBase = hasTraitFilters
            ? Array.from(traitSignatures.cloneIds).filter(id => matchesSelectedTraits(id, selectedTraits))
            : Array.from(traitSignatures.cloneIds);
        listingIds = cloneBase.filter(id => listingNFTs.has(String(id)));
    } else if (hasTraitFilters) {
        listingIds = Object.keys(traitsData).filter(id =>
            listingNFTs.has(String(id)) && matchesSelectedTraits(id, selectedTraits)
        );
    } else {
        listingIds = Object.keys(traitsData).filter(id => listingNFTs.has(String(id)));
    }

    if (hasAffinityFilters) {
        listingIds = listingIds.filter(id => {
            const a = affinityData[id];
            return a
                && (selectedBodyAffinities.size === 0 || selectedBodyAffinities.has(a.body))
                && (selectedHandAffinities.size === 0 || selectedHandAffinities.has(a.hand));
        });
    }
    if (hasActiveStatFilters()) listingIds = listingIds.filter(id => passesStatMinMaxFilters(id));

    filteredNFTIds = currentListingSortOrder
        ? getSortedListingIds(listingIds)
        : getSortedNFTIds(listingIds);
    isFiltering = true;

    const filterSummaryHTML = hasTraitFilters
        ? `<div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">${buildTraitSummaryButtonsHTML(selectedTraits)}</div>`
        : '';

    appendCountHeader(resultsDiv, `Found ${listingIds.length} listing Kamigotchi`, filterSummaryHTML);

    if (filteredNFTIds.length === 0) {
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.textContent = 'No listing Kamigotchi found with current filters';
        resultsDiv.appendChild(noResultsDiv);
        return;
    }

    currentLoadIndex = 0;
    loadMoreNFTs();
    setupInfiniteScroll();
}

function filterByTraits() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.textContent = '';

    const selectedTraits = getSelectedTraitsFromCheckboxes();
    const hasTraitFilters   = Object.keys(selectedTraits).length > 0;
    const hasAffinityFilters = selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;
    const hasStatFilters    = hasActiveStatFilters();

    if (!hasTraitFilters && !hasAffinityFilters && !hasStatFilters) {
        isFiltering = false;
        if (isShowingClonesOnly && !(isShowingListingOnly && currentListingSortOrder)) filterClones();
        else if (isShowingListingOnly) filterListing();
        else { allNFTIds = getSortedNFTIds(Object.keys(traitsData)); loadInitialNFTs(); }
        return;
    }

    const filteringMessage = document.createElement('div');
    filteringMessage.className = 'no-results';
    filteringMessage.textContent = 'Filtering...';
    resultsDiv.appendChild(filteringMessage);

    const baseIDs = isShowingClonesOnly ? Array.from(traitSignatures.cloneIds) : Object.keys(traitsData);

    let matchingNFTs = hasTraitFilters
        ? baseIDs.filter(id => matchesSelectedTraits(id, selectedTraits))
        : baseIDs;

    if (hasAffinityFilters) {
        matchingNFTs = matchingNFTs.filter(id => {
            const a = affinityData[id];
            return a
                && (selectedBodyAffinities.size === 0 || selectedBodyAffinities.has(a.body))
                && (selectedHandAffinities.size === 0 || selectedHandAffinities.has(a.hand));
        });
    }
    if (hasStatFilters)          matchingNFTs = matchingNFTs.filter(id => passesStatMinMaxFilters(id));
    if (isShowingListingOnly)    matchingNFTs = matchingNFTs.filter(id => listingNFTs.has(String(id)));

    filteredNFTIds = (isShowingListingOnly && currentListingSortOrder)
        ? getSortedListingIds(matchingNFTs)
        : getSortedNFTIds(matchingNFTs);
    isFiltering = true;

    if (isShowingClonesOnly && !(isShowingListingOnly && currentListingSortOrder)) { filterClones(); return; }
    if (isShowingListingOnly) { filterListing(); return; }

    resultsDiv.textContent = '';

    const filterSummaryHTML = `
        <div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">
            ${buildTraitSummaryButtonsHTML(selectedTraits)}
        </div>
    `;

    appendCountHeader(
        resultsDiv,
        `Found matching Kamigotchi: ${filteredNFTIds.length}${getAffinityNotation()}`,
        filterSummaryHTML
    );

    if (filteredNFTIds.length === 0) {
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.textContent = 'No Kamigotchi match your selected traits';
        resultsDiv.appendChild(noResultsDiv);
        return;
    }

    currentLoadIndex = 0;
    loadMoreNFTs();
    setupInfiniteScroll();
}

function removeSelectedTrait(event) {
    const { traitType, traitValue } = event.currentTarget.dataset;
    const checkbox = document.querySelector(`.trait-checkbox[data-trait-type="${traitType}"][data-trait-value="${traitValue}"]`);
    if (checkbox) { checkbox.checked = false; updateSelectedTraitsDisplay(true); }
}

function updateSelectedTraitsDisplay(forceUpdate = false) {
    const selectedTraitsDiv = document.getElementById('selectedTraitsDisplay');
    if (selectedTraitsDiv) selectedTraitsDiv.style.display = 'none';

    validateAffinitiesAgainstCheckboxes();

    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');

    if (checkboxes.length === 0 && (isFiltering || forceUpdate)) {
        isFiltering = false;
        filteredNFTIds = [];
        selectedBodyAffinities.clear();
        selectedHandAffinities.clear();
        updateAffinityButtonStates();

        if (isShowingClonesOnly && !(isShowingListingOnly && currentListingSortOrder)) preserveScroll(() => { filterClones(); updateURL(); });
        else if (isShowingListingOnly)    preserveScroll(() => { filterListing(); updateURL(); });
        else if (hasActiveStatFilters())  preserveScroll(() => { filterByTraits(); updateURL(); });
        else                              preserveScroll(() => { allNFTIds = getSortedNFTIds(Object.keys(traitsData)); loadInitialNFTs(); updateURL(); });
        return;
    }

    updateURL();
    if (isShowingListingOnly)     preserveScroll(() => filterListing());
    else if (isShowingClonesOnly) preserveScroll(() => filterClones());
    else                          preserveScroll(() => filterByTraits());
}

function clearFilters() {
    document.querySelectorAll('.trait-checkbox').forEach(cb => cb.checked = false);
    document.querySelectorAll('.trait-search').forEach(input => {
        input.value = '';
        filterTraitOptions(input.dataset.traitType, '');
    });

    const dropdown = document.getElementById('traitCategoryDropdown');
    if (dropdown) dropdown.value = '';
    document.querySelectorAll('.filter-group').forEach(group => group.style.display = 'none');

    selectedBodyAffinities.clear();
    selectedHandAffinities.clear();
    updateAffinityButtonStates();

    document.querySelectorAll('.stat-control').forEach(control => {
        const slider       = control.querySelector('input[type="range"]');
        const valueDisplay = control.querySelector('.stat-control-input-value');
        const toggleInput  = control.querySelector('.toggle-input');
        if (slider) { slider.value = slider.min; if (valueDisplay) valueDisplay.textContent = slider.min; }
        if (toggleInput) toggleInput.checked = false;
    });
    Object.keys(statMinMaxFilters).forEach(statName => {
        const slider = document.querySelector(`.stat-control.${statName} .stat-control-input`);
        statMinMaxFilters[statName].value = slider ? Number(slider.min) : 0;
        statMinMaxFilters[statName].isMax = false;
    });

    isFiltering = false;
    filteredNFTIds = [];

    if (isShowingClonesOnly)       preserveScroll(() => { filterClones(); updateURL(); });
    else if (isShowingListingOnly) preserveScroll(() => { filterListing(); updateURL(); });
    else                           preserveScroll(() => { allNFTIds = getSortedNFTIds(Object.keys(traitsData)); loadInitialNFTs(); updateURL(); });
}


// ============================================================
// NFT CARD RENDERING
// ============================================================

function getStatColorClass() {
    const statSorts = ['harmony', 'health', 'power', 'violence'];
    return statSorts.includes(currentSortOrder) ? currentSortOrder : '';
}

// Global overlay page state: 0 = traits, 1 = stats, 2 = info
let kamiOverlayPage = 0;

function applyKamiPage(page) {
    kamiOverlayPage = page;
    document.querySelectorAll('.nft-card').forEach(c => {
        c.classList.remove('swap-active', 'swap-active-2');
        if (page === 1) c.classList.add('swap-active');
        else if (page === 2) c.classList.add('swap-active-2');
    });
}

function displayNFT(id, showCloseButton = false) {
    const imageUrl = imagesData[id];
    const traits   = traitsData[id];
    const stats    = kamiStatsData[id];

    if (!imageUrl || !traits) {
        console.warn(`NFT #${id} not found in data`);
        return null;
    }

    const rarityData  = nftRarityScores[id];
    const rank        = rarityData ? rarityData.rank : '?';
    const score       = rarityData ? rarityData.score.toFixed(4) : '?';
    const isTied      = rarityData ? rarityData.isTied : false;

    const isNew        = metadataInfo.kamiNewWindow && Object.prototype.hasOwnProperty.call(metadataInfo.kamiNewWindow, String(id));
    const isClone      = traitSignatures.cloneIds.has(id);
    const isSacrificed = sacrificedNFTs.has(String(id));
    const listingData  = listingNFTs.get(String(id));
    const listingPrice = listingData?.price;
    const isListing    = listingData !== undefined;
    const isNewListing = isListing && listingMetaInfo.listingNewWindow && String(id) in listingMetaInfo.listingNewWindow;

    const card = document.createElement('div');
    card.className = 'nft-card hover_wrapper';
    card.dataset.nftId = id;

    const totalNFTs = Object.keys(traitsData).length;
    const rankPercentile = (rank / totalNFTs) * 100;
    let rankClass = 'rank-common';
    if      (rankPercentile <= 1)  rankClass = 'rank-legendary';
    else if (rankPercentile <= 5)  rankClass = 'rank-epic';
    else if (rankPercentile <= 15) rankClass = 'rank-rare';
    else if (rankPercentile <= 40) rankClass = 'rank-uncommon';

    const statColorClass = getStatColorClass();
    const statValue      = stats?.stats[currentSortOrder] || '';
    const rankTooltip    = isTied ? `Rank: #${rank} (Tied) | Score: ${score}` : `Rank: #${rank} | Score: ${score}`;

    const closeButtonHTML    = showCloseButton ? `<button class="close-btn" onclick="removeSelectedID('${id}')" title="Remove this Kamigotchi">×</button>` : '';
    const newBadgeHTML       = isNew        ? `<div class="new-badge" title="Recently Added!">NEW</div>` : '';
    const cloneBadgeHTML     = isClone      ? `<div class="clone-badge" title="This Kamigotchi has identical traits to others">CLONE</div>` : '';
    const sacrificeBadgeHTML = isSacrificed ? `<div class="sacrifice-badge" title="This Kamigotchi has been sacrificed">🕳️</div>` : '';
    const listingBadgeHTML   = isListing    ? `<div class="listing-badge"><img id="kamiswap_icon" src="https://app.kamigotchi.io/assets/marketplace-BqMKbOFC.png" style="border:none"></div>` : '';
    const listingPriceHTML   = isListing    ? `<div class="listing-price">Ξ${listingPrice}</div>` : '';
    const newListingIconHTML = isNewListing ? `<div class="new-listing-icon">New</div>` : '';
    const statColorHTML      = statColorClass
        ? `<div class="stat-color-box ${statColorClass}" title="${statColorClass.charAt(0).toUpperCase() + statColorClass.slice(1)} Sort">${statValue}</div>`
        : '';

    const traitsHTML = Object.entries(traits)
        .map(([key, traitData]) => `
            <div class="trait">
                <p>${key.charAt(0).toUpperCase() + key.slice(1)}: ${getTraitName(traitData)}</p>
            </div>`)
        .join('');

    const kamiStatsHTML = stats ? `
        <div class="kami-stats">
            <div class="stat-row one">
                <div class="stat-item health"><div class="stat-value">${stats.stats.health}</div></div>
                <div class="stat-item power"><div class="stat-value">${stats.stats.power}</div></div>
            </div>
            <div class="stat-row">
                <div class="stat-item violence"><div class="stat-value">${stats.stats.violence}</div></div>
                <div class="stat-item harmony"><div class="stat-value">${stats.stats.harmony}</div></div>
            </div>
        </div>` : '';

    const _kamiInfo    = kamiInfoData[id]    || {};
    const _kamiAccount = kamiToAccount[id]   || {};
    const _kamiName    = _kamiInfo.name      || `Kamigotchi ${id}`;
    const _ownerName   = _kamiAccount.accountName  || '—';
    const _accountIdx  = _kamiAccount.accountIndex != null ? `#${_kamiAccount.accountIndex}` : '—';
    const _level       = _kamiInfo.level     != null ? _kamiInfo.level : '—';
    const _s           = _kamiInfo.stats     || {};
    const _hp          = _s.health   != null ? _s.health   : '—';
    const _pw          = _s.power    != null ? _s.power    : '—';
    const _vl          = _s.violence != null ? _s.violence : '—';
    const _hm          = _s.harmony  != null ? _s.harmony  : '—';

    const kamiInfoHTML = `
        <div class="kami-info">
            <div>${_kamiName}</div><div>Owner: ${_ownerName}</div><div>(Id: ${_accountIdx})</div><div>Level: ${_level}</div><div class="last">stats: ${_hp}/${_pw}/${_vl}/${_hm}</div>
        </div>`;

    const kamiTraitsHTML = `
        <div class="kami-traits">
            ${traitsHTML}
        </div>`;

    const kamiOverlayControlsHTML = `
        <div class="kami-overlay-controls">
            <button class="kami-overlay-arrow" title="Switch page"></button>
        </div>`;
    


    const rankBadge = `
        <div class="rank-stat-container">
            <div class="rank-badge ${rankClass}" title="${rankTooltip}">${rank}</div>
            ${statColorHTML}
            ${newBadgeHTML}
            ${cloneBadgeHTML}
        </div>`;

    const imageBlock = `
        <div class="image-container">
            <img src="${imageUrl}" alt="NFT #${id}" loading="lazy" onerror="this.src='https://via.placeholder.com/250?text=Not+Found'">
            ${sacrificeBadgeHTML}
            ${listingBadgeHTML}
            ${listingPriceHTML}
            ${newListingIconHTML}
        </div>`;

    if (isMobile) {
        card.innerHTML = `
            ${closeButtonHTML}
            ${rankBadge}
            ${kamiTraitsHTML}
            ${kamiInfoHTML}
            ${kamiStatsHTML}
            ${kamiOverlayControlsHTML}
            <div class="nft-card-content">
                ${imageBlock}
                <div class="nft-id">Kamigotchi ${id}</div>
            </div>`;
    } else {
        card.innerHTML = `
            ${closeButtonHTML}
            ${rankBadge}
            ${kamiTraitsHTML}
            ${kamiInfoHTML}
            ${kamiStatsHTML}
            ${kamiOverlayControlsHTML}
            <div class="nft-card-content">
                ${imageBlock}
                <div class="nft-id">Kamigotchi ${id}</div>
            </div>`;
    }

    card.querySelector('.kami-overlay-arrow').addEventListener('click', (e) => {
        e.stopPropagation();
        // Cycle all cards together: traits(0) → stats(1) → info(2) → traits ...
        applyKamiPage((kamiOverlayPage + 1) % 3);
    });

    // kami-traits always visible by default; sync to current global page
    card.classList.add('is-active');
    if (kamiOverlayPage === 1) card.classList.add('swap-active');
    else if (kamiOverlayPage === 2) card.classList.add('swap-active-2');

    return card;
}


// ============================================================
// INFINITE SCROLL & CARD LOADING
// ============================================================

function loadInitialNFTs() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.textContent = '';

    const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;

    let title = 'Showing all Kamigotchi';
    if (isShowingClonesOnly) {
        const uniqueSignatures = new Set(idsToDisplay.map(id => traitSignatures.signatures[id]));
        title = `Showing ${idsToDisplay.length} clones in ${uniqueSignatures.size} groups`;
    } else if (isFiltering) {
        title = 'Found matching Kamigotchi';
    }

    resultsDiv.appendChild(createCountHeader(idsToDisplay.length, title));
    currentLoadIndex = 0;
    loadMoreNFTs();
    setupInfiniteScroll();
}

function loadMoreNFTs() {
    if (isLoading) return;
    isLoading = true;

    const resultsDiv   = document.getElementById('results');
    const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
    const endIndex     = Math.min(currentLoadIndex + LAZY_LOAD_COUNT, idsToDisplay.length);

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

        if (nftObserver) {
            const cards = resultsDiv.querySelectorAll('.nft-card');
            if (cards.length > 0) nftObserver.observe(cards[cards.length - 1]);
        }
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
    if (currentLoadIndex >= idsToDisplay.length) indicator.style.display = 'none';
}

function setupInfiniteScroll() {
    if (nftObserver) nftObserver.disconnect();

    nftObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
            if (entry.isIntersecting && currentLoadIndex < idsToDisplay.length && !isLoading) {
                loadMoreNFTs();
            }
        });
    }, { rootMargin: '200px' });

    const cards = document.querySelectorAll('.nft-card');
    if (cards.length > 0) nftObserver.observe(cards[cards.length - 1]);
}

function createCountHeader(count, title) {
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    countDiv.innerHTML = `
        <div style="font-size: 14px;">${title}: ${count}</div>
        <div class="note">** click the lil arrow on card for og stats and more info **</div>
    `;
    return countDiv;
}


// ============================================================
// SELECTED IDs (COMPARISON AREA)
// ============================================================

function updateSelectedIDsDisplay() {
    const selectedIDsDiv = document.getElementById('selectedIDs');

    if (selectedIDs.size === 0) {
        selectedIDsDiv.style.display = 'none';
        return;
    }

    selectedIDsDiv.style.display = 'block';
    selectedIDsDiv.innerHTML = '';
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'selected-cards-grid';

    // Convert Set to Array for sorting
    let idsArray = Array.from(selectedIDs);

    // Check if we are in Listing mode and a sort order is active
    // This ensures the selected grid mirrors the marketplace sort logic
    if (isShowingListingOnly && currentListingSortOrder) {
        idsArray = getSortedListingIds(idsArray);
    } else {
        idsArray = getSortedNFTIds(idsArray);
    }

    idsArray.forEach(id => {
        const card = displayNFT(id, true);
        if (card) cardsContainer.appendChild(card);
    });

    selectedIDsDiv.appendChild(cardsContainer);
    updateURL();
}

function searchByID() {
    const searchInput = document.getElementById('searchInput');
    const id = searchInput.value.trim();

    const showMessage = (text) => {
        const messageBox = document.getElementById('messageBox');
        messageBox.textContent = text;
        messageBox.style.display = 'block';
        setTimeout(() => messageBox.style.display = 'none', 3000);
    };

    if (!id)                               { showMessage('Please enter an NFT ID'); return; }
    if (!imagesData[id] || !traitsData[id]) { showMessage(`Kamigotchi #${id} not found. Please check the ID and try again.`); return; }
    if (selectedIDs.has(id))               { showMessage(`Kamigotchi #${id} is already added!`); return; }

    selectedIDs.add(id);
    updateSelectedIDsDisplay();
    searchInput.value = '';
    updateURL();
}

function removeSelectedID(id) {
    selectedIDs.delete(id);
    updateSelectedIDsDisplay();
    updateURL();
}
window.removeSelectedID = removeSelectedID;

function clearAllSelectedIDs() {
    selectedIDs.clear();
    updateSelectedIDsDisplay();
    document.getElementById('searchInput').value = '';
    updateURL();
}


// ============================================================
// DATA FETCHING
// ============================================================

async function loadSacrificeData(v) {
    try {
        const response = await fetch(`/api/sacrifices?v=${v}`);
        if (response.ok) {
            const data = await response.json();
            sacrificedNFTs = new Set(data.map(item => String(item.kami_index)));
            console.log(`🕳️ Loaded ${sacrificedNFTs.size} sacrifice records`);
        }
    } catch (err) {}
}

async function loadListingsData(v) {
    try {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.');
        const finalUrl = isLocal
            ? `https://data.kami.h80h.xyz/kamiListings.json?v=${v}`
            : `/api/data/kamiListings.json?v=${v}`;
        const response = await fetch(finalUrl);
        if (response.ok) {
            const data = await response.json();
            const rawListings = (data && typeof data === 'object' && 'listings' in data) ? data.listings : data;
            listingNFTs = new Map(Object.values(rawListings).map((item) => {
                if (item !== null && typeof item === 'object') {
                    return [String(item.id), { price: item.price, timestamp: item.rawTime ?? null }];
                } else {
                    return [String(item), { price: item, timestamp: null }];
                }
            }));
            listingMetaInfo = {
                newListingId: (data?.newListingId ?? []).map(String),
                listingNewWindow: data?.listingNewWindow ?? {},
            };
            console.log(`🛍️ Loaded ${listingNFTs.size} listing Kamigotchi on KamiSwap`);
            if (listingMetaInfo.newListingId.length > 0) {
                console.log(`✨ Found ${listingMetaInfo.newListingId.length} new listing(s): ${listingMetaInfo.newListingId.join(', ')}`);
            }
        }
    } catch (err) {}
}

async function loadKamiInfoData(v) {
    try {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.');
        const [infoRes, accountsRes] = await Promise.all([
            fetch(isLocal ? `https://data.kami.h80h.xyz/kamiInfo.json?v=${v}` : `/api/data/kamiInfo.json?v=${v}`),
            fetch(isLocal ? `https://data.kami.h80h.xyz/kamiAccounts.json?v=${v}` : `/api/data/kamiAccounts.json?v=${v}`),
        ]);
        if (infoRes.ok)     kamiInfoData     = await infoRes.json();
        if (accountsRes.ok) kamiAccountsData = await accountsRes.json();
        // Build reverse lookup: kamiIndex → { accountIndex, accountName }
        kamiToAccount = {};
        Object.entries(kamiAccountsData).forEach(([accountIndex, acc]) => {
            (acc.kamis || []).forEach(kamiIndex => {
                kamiToAccount[kamiIndex] = { accountIndex, accountName: acc.name };
            });
        });
        console.log(`📖 Loaded info for ${Object.keys(kamiInfoData).length} Kamigotchi, ${Object.keys(kamiAccountsData).length} accounts`);
    } catch (err) {}
}

function getSignificantListingsHash(listingsData) {
    return JSON.stringify({
        listings: Object.fromEntries(listingNFTs),
        listingNewWindow: listingsData?.listingNewWindow ?? {},
    });
}

function getSignificantMetaHash(meta) {
    return JSON.stringify({
        previousMaxId: meta.previousMaxId,
        newKamiIds:    meta.newKamiIds,
        kamiNewWindow: meta.kamiNewWindow,
        totalCount:    meta.totalCount,
    });
}

async function checkForUpdates() {
    try {
        const v = Math.floor(Date.now() / (5 * 60 * 1000));
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.');
        const baseUrl = isLocal ? 'https://data.kami.h80h.xyz' : '/api/data';

        const [listingsRes, metaRes] = await Promise.all([
            fetch(`${baseUrl}/kamiListings.json?v=${v}`),
            fetch(`${baseUrl}/kamiMeta.json?v=${v}`),
        ]);

        let shouldRefresh = false;

        if (listingsRes.ok) {
            const newListings = await listingsRes.json();
            const newHash = getSignificantListingsHash(newListings);
            if (cachedListingsHash && newHash !== cachedListingsHash) {
                console.log('🛍️ Listings changed, refreshing all data...');
                shouldRefresh = true;
            }
            cachedListingsHash = newHash;
            const newListingMetaHash = JSON.stringify(newListings?.listingNewWindow ?? {});
            if (cachedListingsMetaHash && newListingMetaHash !== cachedListingsMetaHash) {
                console.log('✨ Listing window changed, refreshing all data...');
                shouldRefresh = true;
            }
            cachedListingsMetaHash = newListingMetaHash;
        }

        if (metaRes.ok) {
            const newMeta = await metaRes.json();
            const newHash = getSignificantMetaHash(newMeta);
            if (cachedMetaHash && newHash !== cachedMetaHash) {
                console.log('✨ Metadata changed, refreshing all data...');
                shouldRefresh = true;
            }
            cachedMetaHash = newHash;
        }

        if (shouldRefresh) await refreshData();
    } catch (err) {}
}

function startAutoRefresh() {
    setInterval(checkForUpdates, 5 * 60 * 1000);
}

async function fetchAndSplitBundle(v) {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.');
    const finalUrl = isLocal
        ? `https://data.kami.h80h.xyz/kamiBundle.json?v=${v}`
        : `/api/data/kamiBundle.json?v=${v}`;

    const response = await fetch(finalUrl);
    if (!response.ok) throw new Error(`Failed to load kamiBundle.json: ${response.status}`);

    let bundle = await response.json();
    if (!bundle.kamiImage || !bundle.kamiTraits) {
        bundle = null;
        throw new Error('Bundle is missing required sections (kamiImage / kamiTraits)');
    }

    imagesData    = bundle.kamiImage;                        bundle.kamiImage    = null;
    traitsData    = bundle.kamiTraits;                       bundle.kamiTraits   = null;
    kamiStatsData = bundle.kamiStats  || {};                 bundle.kamiStats    = null;
    metadataInfo  = bundle.kamiMetadata || { newKamiIds: [] }; bundle.kamiMetadata = null;
    bundle = null;
}

function processLoadedData() {
    affinityData        = extractAffinityData();
    traitAffinityLookup = buildTraitAffinityLookup();
    traitSignatures     = buildTraitSignatures();
    traitCounts         = calculateTraitCounts();
    nftRarityScores     = calculateRarityScores();
    console.log('✅ OpenRarity calculation complete!');
}

async function loadData() {
    try {
        console.log('📄 Loading bundle with cache-busting...');
        const v = Date.now();

        await Promise.all([
            fetchAndSplitBundle(v),
            loadSacrificeData(v),
            loadListingsData(v),
            loadKamiInfoData(v),
        ]);
        if (metadataInfo.newKamiIds?.length > 0) {
            console.log(`✨ Found ${metadataInfo.newKamiIds.length} new Kamigotchi!`);
            console.log(`   New IDs: ${metadataInfo.newKamiIds.join(', ')}`);
        }

        processLoadedData();

        setupSortButtons();
        setupCloneFilterButton();
        setupListingFilterButton();
        setupListingSortButtons();
        setupAffinityFilterToggle();
        setupMinMaxFilterToggle();
        setupAffinityFilters();
        createFilterControls();

        const initialFilterActive = loadStateFromURL();

        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        if (!currentListingSortOrder) {
            document.querySelector(`.sort-btn[data-sort="${currentSortOrder}"]`)?.classList.add('active');
        }
        document.getElementById('cloneFilterBtn')?.classList.toggle('active', isShowingClonesOnly);
        document.getElementById('listingFilterBtn')?.classList.toggle('active', isShowingListingOnly);

        const listingSortSection = document.querySelector('.listing-sort-section');
        if (listingSortSection) listingSortSection.style.display = isShowingListingOnly ? 'block' : 'none';
        if (isShowingListingOnly && currentListingSortOrder) {
            document.querySelector(`.listing-sort-btn[listing-data-sort="${currentListingSortOrder}"]`)?.classList.add('active');
        }

        updateSelectedIDsDisplay();
        allNFTIds = getSortedNFTIds();

        if (initialFilterActive)       filterByTraits();
        else if (isShowingClonesOnly)  filterClones();
        else if (isShowingListingOnly) filterListing();
        else                           loadInitialNFTs();

        updateURL(true);

        const now = new Date();
        const label = `Last updated:\n${now.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${now.toLocaleTimeString()}`;
        document.getElementById('refreshDataBtn')?.setAttribute('data-tooltip', label);

        cachedListingsHash     = getSignificantListingsHash(listingMetaInfo);
        cachedListingsMetaHash = JSON.stringify(listingMetaInfo.listingNewWindow);
        cachedMetaHash         = getSignificantMetaHash(metadataInfo);
        startAutoRefresh();

    } catch (error) {
        console.error('Detailed error:', error);
        document.getElementById('results').innerHTML = `
            <div class="no-results">
                <strong>Error loading NFT data</strong><br><br>
                ${error.message}<br><br>
            </div>`;
    } finally {
        hideLoader();
        showContainer();
    }
}

async function refreshData() {
    if (isRefreshing) return;
    isRefreshing = true;

    const refreshBtn   = document.getElementById('refreshDataBtn');
    const originalText = refreshBtn.innerHTML;
    refreshBtn.disabled = true;

    try {
        console.log('🔄 Refreshing data...');

        const currentFilters        = getTraitStringFromState();
        const currentAffinityString = getAffinityStringFromState();
        const currentMinMaxString   = getMinMaxStringFromState();
        const currentSort           = currentSortOrder;
        const currentListingSort    = currentListingSortOrder;
        const wasShowingClones      = isShowingClonesOnly;
        const wasShowingListing     = isShowingListingOnly;

        const v = Date.now();
        await Promise.all([
            fetchAndSplitBundle(v),
            loadSacrificeData(v),
            loadListingsData(v),
            loadKamiInfoData(v),
        ]);

        if (Object.keys(kamiStatsData).length > 0) {
            console.log(`✅ Re-loaded stats data for ${Object.keys(kamiStatsData).length} Kamigotchi`);
        }
        if (metadataInfo.newKamiIds?.length > 0) {
            console.log(`✨ Found ${metadataInfo.newKamiIds.length} new Kamigotchi!`);
            console.log(`   New IDs: ${metadataInfo.newKamiIds.join(', ')}`);
        }

        processLoadedData();

        currentSortOrder     = currentSort;
        currentListingSortOrder = currentListingSort;
        isShowingClonesOnly  = wasShowingClones;
        isShowingListingOnly = wasShowingListing;
        allNFTIds = getSortedNFTIds();

        const filterControls = document.getElementById('filterControls');
        const visibleFilterGroup = document.querySelector('.filter-group[style*="display: block"], .filter-group[style*="display:block"]');
        const visibleTraitType   = visibleFilterGroup ? visibleFilterGroup.dataset.traitType : null;
        const affinityWasVisible = document.querySelector('.affinity-filter-section')?.style.display === 'block';
        const minmaxWasVisible   = document.querySelector('.minmax-filter-section')?.style.display === 'block';
        filterControls.innerHTML = '';
        createFilterControls();
        if (visibleTraitType) {
            const restoredGroup = document.querySelector(`.filter-group[data-trait-type="${visibleTraitType}"]`);
            if (restoredGroup) restoredGroup.style.display = 'block';
            const dropdown = document.getElementById('traitCategoryDropdown');
            if (dropdown) dropdown.value = visibleTraitType;
        }

        if (currentFilters || currentAffinityString || currentMinMaxString) {
            const originalSearch = window.location.search;
            const params = new URLSearchParams();
            if (currentFilters)        params.set('traits',   currentFilters);
            if (currentAffinityString) params.set('affinity', currentAffinityString);
            if (currentMinMaxString)   params.set('minmax',   currentMinMaxString);
            history.replaceState(null, '', `?${params.toString()}`);
            loadStateFromURL({ restorePanels: false });
            history.replaceState(null, '', originalSearch);
            currentListingSortOrder = currentListingSort;
            isShowingClonesOnly     = wasShowingClones;
            isShowingListingOnly    = wasShowingListing;
        }

        const affinitySection = document.querySelector('.affinity-filter-section');
        const affinityToggle  = document.getElementById('affinityFilterToggle');
        if (affinitySection) affinitySection.style.display = affinityWasVisible ? 'block' : 'none';
        if (affinityToggle)  affinityToggle.classList.toggle('active', affinityWasVisible);

        const minmaxSection = document.querySelector('.minmax-filter-section');
        const minmaxToggle  = document.getElementById('minmaxFilterToggle');
        if (minmaxSection) minmaxSection.style.display = minmaxWasVisible ? 'block' : 'none';
        if (minmaxToggle)  minmaxToggle.classList.toggle('active', minmaxWasVisible);

        document.getElementById('cloneFilterBtn')?.classList.toggle('active', isShowingClonesOnly);
        document.getElementById('listingFilterBtn')?.classList.toggle('active', isShowingListingOnly);

        const listingSortSectionRefresh = document.querySelector('.listing-sort-section');
        if (listingSortSectionRefresh) listingSortSectionRefresh.style.display = isShowingListingOnly ? 'block' : 'none';
        document.querySelectorAll('.listing-sort-btn').forEach(b => b.classList.remove('active'));
        if (isShowingListingOnly && currentListingSortOrder) {
            document.querySelector(`.listing-sort-btn[listing-data-sort="${currentListingSortOrder}"]`)?.classList.add('active');
        }

        const hasAnyFilter = currentFilters || currentAffinityString || currentMinMaxString;
        preserveScroll(() => {
            if (isShowingClonesOnly && !(isShowingListingOnly && currentListingSortOrder)) filterClones();
            else if (isShowingListingOnly) filterListing();
            else if (hasAnyFilter)         filterByTraits();
            else                           { isFiltering = false; loadInitialNFTs(); }
        });

        updateURL(true);

        refreshBtn.innerHTML = `<svg id="refreshComplete" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><mask id="SVGkzXYXbbR"><g fill="none" stroke="#fff" stroke-dasharray="24" stroke-dashoffset="24" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.4s" values="24;0"/></path><path stroke="#000" stroke-width="6" d="M7.5 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.4s" dur="0.4s" values="24;0"/></path><path d="M7.5 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.4s" dur="0.4s" values="24;0"/></path></g></mask><rect width="24" height="24" fill="currentColor" mask="url(#SVGkzXYXbbR)"/></svg>`;
        setTimeout(() => {
            refreshBtn.innerHTML = originalText;
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = '1';
            isRefreshing = false;
            const now = new Date();
            const label = `Last updated: ${now.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${now.toLocaleTimeString()}`;
            document.getElementById('refreshDataBtn')?.setAttribute('data-tooltip', label);
        }, 2000);

    } catch (error) {
        console.error('Error refreshing data:', error);
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


// ============================================================
// SCROLL TO TOP
// ============================================================

function setupScrollToTop() {
    const scrollBtn = document.getElementById('scrollToTop');
    let lastScrollTop = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        if (currentScroll > 300) {
            scrollBtn.classList.toggle('show', currentScroll > lastScrollTop);
        } else {
            scrollBtn.classList.remove('show');
        }
        lastScrollTop = currentScroll;
    });

    scrollBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function setupRefreshButton() {
    document.getElementById('refreshDataBtn')?.addEventListener('click', refreshData);
}


// ============================================================
// INIT
// ============================================================

document.getElementById('searchBtn').addEventListener('click', searchByID);
document.getElementById('searchInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') searchByID(); });
document.getElementById('clearSearchBtn').addEventListener('click', clearAllSelectedIDs);
document.getElementById('clearBtn').addEventListener('click', clearFilters);

document.addEventListener('DOMContentLoaded', () => {
    setupScrollToTop();
    setupRefreshButton();
    window.addEventListener('popstate', handlePopState);

    document.addEventListener('click', (e) => {
        // Cards are dismissed only via their close button, not outside clicks

        const filterControls = document.getElementById('filterControls');
        if (filterControls && !filterControls.contains(e.target)) {
            document.querySelectorAll('.filter-group').forEach(group => group.style.display = 'none');
            const dropdown = document.getElementById('traitCategoryDropdown');
            if (dropdown) dropdown.value = '';
        }
    });
});

if (!document.getElementById('enhanced-trait-styles')) {
    const styleTag = document.createElement('style');
    styleTag.id = 'enhanced-trait-styles';
    styleTag.textContent = `
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
    document.head.appendChild(styleTag);

    const messageBox = document.createElement('div');
    messageBox.id = 'messageBox';
    document.body.appendChild(messageBox);

    document.addEventListener('mouseover', (e) => {
        if (e.target.closest('.listing-badge') || e.target.closest('.new-listing-icon')) {
            const container = e.target.closest('.image-container');
            const price = container?.querySelector('.listing-price');
            if (price) price.style.opacity = '0.7';
        }
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('.listing-badge') || e.target.closest('.new-listing-icon')) {
            const container = e.target.closest('.image-container');
            const price = container?.querySelector('.listing-price');
            if (price) price.style.opacity = '';
        }
    });
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(r => r.unregister());
    });
}

loadData();