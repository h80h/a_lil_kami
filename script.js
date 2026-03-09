// ============================================================
// BOT ARMOR — throttle duplicate requests to the database
// ============================================================
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

// Data stores
let imagesData = {};
let traitsData = {};
let kamiStatsData = {};
let affinityData = {};
let metadataInfo = {};
let sacrificedNFTs = new Set();
let listingNFTs = new Map();

// Auto-refresh state
let cachedListingsHash = null;
let cachedMetaHash = null;

// Derived lookup structures
let traitSignatures = {};
let traitAffinityLookup = {}; // { body: { TraitName: affinity }, hand: { ... } } — O(1) affinity lookups
let traitCounts = {};
let nftRarityScores = {};

// Display state
let allNFTIds = [];
let filteredNFTIds = [];
let selectedIDs = new Set();
let currentLoadIndex = 0;
let currentSortOrder = 'latest';
let isFiltering = false;
let isLoading = false;
let isRefreshing = false;
let nftObserver = null;

// Filter state
let isShowingClonesOnly = false;
let isShowingListingOnly = false;
let selectedBodyAffinities = new Set();
let selectedHandAffinities = new Set();

// Stat min/max filter state — isMax=false means ">= value", isMax=true means "<= value"
let statMinMaxFilters = {
    health:   { value: 50, isMax: false },
    power:    { value: 10, isMax: false },
    violence: { value: 10, isMax: false },
    harmony:  { value: 10, isMax: false },
    slots:    { value: 0,  isMax: false },
};

const INITIAL_LOAD_COUNT = 50;
const LAZY_LOAD_COUNT = 30;

// Cache isMobile to avoid per-card layout reflow from window.innerWidth
let isMobile = window.innerWidth <= 390;
window.addEventListener('resize', () => { isMobile = window.innerWidth <= 390; }, { passive: true });


// ============================================================
// URL SYNCHRONIZATION
// ============================================================

// Serialize trait checkboxes to URL string, skipping traits already covered by an active affinity
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
    if (isShowingListingOnly) params.set('listing', 'true');

    const affinityString = getAffinityStringFromState();
    if (affinityString) params.set('affinity', affinityString);

    const minMaxString = getMinMaxStringFromState();
    if (minMaxString) params.set('minmax', minMaxString);

    const queryString = params.toString();
    const newUrl = queryString
        ? `${window.location.pathname}?${queryString}${window.location.hash}`
        : `${window.location.pathname}${window.location.hash}`;

    if (replace) {
        history.replaceState(null, '', newUrl);
    } else {
        history.pushState(null, '', newUrl);
    }
}

function loadStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    let hasFilters = false;

    // Sort order
    const urlSort = params.get('sort');
    if (urlSort) currentSortOrder = urlSort;

    // Selected IDs
    const urlIDs = params.get('ids');
    if (urlIDs) {
        selectedIDs = new Set(urlIDs.split(',').map(id => id.trim()).filter(Boolean));
    }

    // Clone / listing flags
    isShowingClonesOnly = params.get('clones') === 'true';
    isShowingListingOnly = params.get('listing') === 'true';

    // Trait filters
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

    // Affinity filters
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

        const affinitySection = document.querySelector('.affinity-filter-section');
        const toggleBtn = document.getElementById('affinityFilterToggle');
        if (affinitySection && toggleBtn) {
            affinitySection.style.display = 'block';
            toggleBtn.classList.add('active');
        }
        updateAffinityButtonStates();
    }

    // Stat min/max filters
    const urlMinMax = params.get('minmax');
    if (urlMinMax) {
        urlMinMax.split(';').forEach(part => {
            const [statName, value, mode] = part.split(':');
            if (statName && value && statMinMaxFilters[statName] !== undefined) {
                const isMax = mode === 'max';
                statMinMaxFilters[statName].value = Number(value);
                statMinMaxFilters[statName].isMax = isMax;

                const slider = document.querySelector(`.stat-control.${statName} .stat-control-input`);
                const valueDisplay = document.querySelector(`.stat-control.${statName} .stat-control-input-value`);
                const toggleInput = document.querySelector(`.stat-control.${statName} .toggle-input`);
                if (slider) slider.value = value;
                if (valueDisplay) valueDisplay.textContent = value;
                if (toggleInput) toggleInput.checked = isMax;
            }
        });

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

function handlePopState() {
    const hasFilters = loadStateFromURL();

    updateSelectedIDsDisplay();
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    const sortButton = document.querySelector(`.sort-btn[data-sort="${currentSortOrder}"]`);
    if (sortButton) sortButton.classList.add('active');

    const cloneBtn = document.getElementById('cloneFilterBtn');
    if (cloneBtn) cloneBtn.classList.toggle('active', isShowingClonesOnly);

    const listingBtn = document.getElementById('listingFilterBtn');
    if (listingBtn) listingBtn.classList.toggle('active', isShowingListingOnly);

    if (isShowingClonesOnly) filterClones();
    else if (isShowingListingOnly) filterListing();
    else if (hasFilters) filterByTraits();
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

    if (typeof window.startHonestTracking === 'function') {
        window.startHonestTracking();
    }

    // Delay matches the loader's CSS fade-out duration
    setTimeout(() => {
        updateLiveStatus();
        loader.style.display = 'none';
    }, 300);

    if (!window.liveStatusInterval) {
        window.liveStatusInterval = setInterval(updateLiveStatus, 60000);
    }
}

function showContainer() {
    const container = document.querySelector('.container');
    container.style.display = 'block';
    setTimeout(() => { container.style.opacity = '1'; }, 50);
}


// ============================================================
// DATA HELPERS
// ============================================================

// Handles both legacy string format and new object format for trait data
function getTraitName(traitData) {
    return typeof traitData === 'string' ? traitData : traitData.name;
}

// Builds a deterministic signature string from an NFT's traits (used for clone detection)
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

// OpenRarity — normalized information content scoring
function calculateRarityScores() {
    const totalNFTs = Object.keys(traitsData).length;
    const scores = {};

    // Step 1: Information Content per trait — IC = -log(probability)
    const traitIC = {};
    Object.entries(traitCounts).forEach(([category, traits]) => {
        traitIC[category] = {};
        Object.entries(traits).forEach(([traitName, count]) => {
            traitIC[category][traitName] = -Math.log(count / totalNFTs);
        });
    });

    // Step 2: Max IC per category (for normalization)
    const maxICPerCategory = {};
    Object.entries(traitIC).forEach(([category, traits]) => {
        maxICPerCategory[category] = Math.max(...Object.values(traits));
    });

    // Step 3: Normalized score per NFT (average across all trait categories)
    Object.entries(traitsData).forEach(([id, traits]) => {
        let normalizedScore = 0;
        Object.entries(traits).forEach(([category, traitData]) => {
            const traitName = getTraitName(traitData);
            normalizedScore += traitIC[category][traitName] / maxICPerCategory[category];
        });
        scores[id] = normalizedScore / Object.keys(traits).length;
    });

    // Step 4: Rank by score (higher = rarer), detect ties
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

// Builds a flat lookup map for O(1) trait → affinity resolution
// Replaces the expensive Object.values(traitsData).find() pattern in hot paths
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

// Returns sorted NFT IDs respecting current sort order; always keeps clone groups adjacent
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

    // Chronological sort
    if (currentSortOrder === 'latest' || currentSortOrder === 'oldest') {
        if (isShowingClonesOnly) {
            // Group clones by their representative (highest/lowest) ID
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

    // Stat / rarity sort — always groups clones, uses latest ID as tiebreaker
    return ids.sort((a, b) => {
        const sigA = traitSignatures.signatures[a];
        const sigB = traitSignatures.signatures[b];

        if (sigA !== sigB) {
            const statA = getStatValue(a);
            const statB = getStatValue(b);
            if (statA !== statB) {
                return currentSortOrder === 'rarity' ? statA - statB : statB - statA;
            }
            const repA = Math.max(...traitSignatures.groups[sigA].map(Number));
            const repB = Math.max(...traitSignatures.groups[sigB].map(Number));
            return repB - repA;
        }

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

// Helper used in filterClones and filterByTraits to build the affinity short-code string "(N/I)" etc.
const AFFINITY_MAP = { NORMAL: 'N', INSECT: 'I', SCRAP: 'S', EERIE: 'E' };

function getAffinityNotation() {
    if (selectedBodyAffinities.size === 0 && selectedHandAffinities.size === 0) return '';
    const bChar = AFFINITY_MAP[Array.from(selectedBodyAffinities)[0]] || '';
    const hChar = AFFINITY_MAP[Array.from(selectedHandAffinities)[0]] || '';
    return ` (${bChar}/${hChar})`;
}

// Builds the removable filter-tag buttons HTML from a map of { traitType: [values] }
function buildTraitSummaryButtonsHTML(selectedTraits) {
    return Object.entries(selectedTraits).flatMap(([type, values]) =>
        values.map(value => `
            <button class="count-header-trait-btn" data-trait-type="${type}" data-trait-value="${value}"
                    title="Click to remove filter: ${type}: ${value}">
                ${type}: ${value} ×
            </button>`)
    ).join('');
}

// Collects currently checked trait checkboxes into a { traitType: [values] } map
function getSelectedTraitsFromCheckboxes() {
    const selectedTraits = {};
    document.querySelectorAll('.trait-checkbox:checked').forEach(checkbox => {
        const type = checkbox.dataset.traitType;
        const value = checkbox.dataset.traitValue;
        if (!selectedTraits[type]) selectedTraits[type] = [];
        selectedTraits[type].push(value);
    });
    return selectedTraits;
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
            const slider = document.querySelector(`.stat-control.${statName} .stat-control-input`);
            const valueDisplay = document.querySelector(`.stat-control.${statName} .stat-control-input-value`);
            const toggleInput = document.querySelector(`.stat-control.${statName} .toggle-input`);
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

// Builds and appends a count/filter-summary header div into resultsDiv
function appendCountHeader(resultsDiv, summaryText, filterSummaryHTML = '') {
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    countDiv.innerHTML = `
        <div id="count-summary" style="font-size: 14px;">${summaryText}</div>
        <div class="note">** dear mobile user, click card to show og stats **</div>
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

// Shared "return to previous view" logic used by clone and listing toggle buttons
function restoreViewAfterToggle() {
    const hasAffinityFilters = selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;
    if (isFiltering || hasAffinityFilters) {
        preserveScroll(() => { filterByTraits(); updateURL(); });
    } else {
        preserveScroll(() => { allNFTIds = getSortedNFTIds(); loadInitialNFTs(); updateURL(); });
    }
}


// ============================================================
// SETUP — SORT & FILTER BUTTON WIRING
// ============================================================

function setupSortButtons() {
    const sortButtons = document.querySelectorAll('.sort-btn');
    sortButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const newSort = e.target.dataset.sort;
            if (newSort === currentSortOrder) return;

            currentSortOrder = newSort;
            sortButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            if (isShowingClonesOnly)       preserveScroll(() => filterClones());
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

        if (isShowingClonesOnly) {
            preserveScroll(() => { filterClones(); updateURL(); });
        } else if (isShowingListingOnly) {
            preserveScroll(() => { filterListing(); updateURL(); });
        } else {
            restoreViewAfterToggle();
        }
    });
}

function setupListingFilterButton() {
    const listingBtn = document.getElementById('listingFilterBtn');
    if (!listingBtn) return;

    listingBtn.addEventListener('click', () => {
        isShowingListingOnly = !isShowingListingOnly;
        listingBtn.classList.toggle('active', isShowingListingOnly);

        if (isShowingListingOnly) {
            preserveScroll(() => { filterListing(); updateURL(); });
        } else if (isShowingClonesOnly) {
            preserveScroll(() => { filterClones(); updateURL(); });
        } else {
            restoreViewAfterToggle();
        }
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

// Clicking an affinity button selects all traits of that affinity and deselects the previous one
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
    preserveScroll(() => { filterByTraits(); updateURL(); });
}

// Validates whether the current checkbox state still matches an active affinity; deactivates if not
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
    const slider = control.querySelector('input[type="range"]');
    const valueDisplay = control.querySelector('.stat-control-input-value');
    const toggleInput = control.querySelector('.toggle-input');

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
            if (isShowingClonesOnly)            filterClones();
            else if (isShowingListingOnly)      filterListing();
            else if (isFiltering || hasActiveStatFilters()) filterByTraits();
            else { allNFTIds = getSortedNFTIds(Object.keys(traitsData)); loadInitialNFTs(); }
            updateURL();
        });
    }, 200);
}

// Preserves scroll position across a filter re-render
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

    // Dropdown
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

    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    const hasTraitFilters = checkboxes.length > 0;
    const hasAffinityFilters = selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;

    let cloneIds = (hasTraitFilters && isFiltering)
        ? filteredNFTIds.filter(id => traitSignatures.cloneIds.has(id))
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
    if (isShowingListingOnly) cloneIds = cloneIds.filter(id => listingNFTs.has(String(id)));

    filteredNFTIds = getSortedNFTIds(cloneIds);
    isFiltering = true;

    const uniqueSignatures = new Set(cloneIds.map(id => traitSignatures.signatures[id]));
    const filterSummaryHTML = hasTraitFilters
        ? `<div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">${buildTraitSummaryButtonsHTML(getSelectedTraitsFromCheckboxes())}</div>`
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

    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    const hasTraitFilters = checkboxes.length > 0;
    const hasAffinityFilters = selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;

    let listingIds;
    if (isShowingClonesOnly) {
        const cloneBase = (hasTraitFilters && isFiltering)
            ? filteredNFTIds.filter(id => traitSignatures.cloneIds.has(id))
            : Array.from(traitSignatures.cloneIds);
        listingIds = cloneBase.filter(id => listingNFTs.has(String(id)));
    } else if (hasTraitFilters && isFiltering) {
        listingIds = filteredNFTIds.filter(id => listingNFTs.has(String(id)));
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

    filteredNFTIds = getSortedNFTIds(listingIds);
    isFiltering = true;

    const filterSummaryHTML = hasTraitFilters
        ? `<div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">${buildTraitSummaryButtonsHTML(getSelectedTraitsFromCheckboxes())}</div>`
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

    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    const hasTraitFilters = checkboxes.length > 0;
    const hasAffinityFilters = selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;
    const hasStatFilters = hasActiveStatFilters();

    if (!hasTraitFilters && !hasAffinityFilters && !hasStatFilters) {
        isFiltering = false;
        if (isShowingClonesOnly) filterClones();
        else { allNFTIds = getSortedNFTIds(Object.keys(traitsData)); loadInitialNFTs(); }
        return;
    }

    const filteringMessage = document.createElement('div');
    filteringMessage.className = 'no-results';
    filteringMessage.textContent = 'Filtering...';
    resultsDiv.appendChild(filteringMessage);

    const selectedTraits = {};
    checkboxes.forEach(checkbox => {
        const type = checkbox.dataset.traitType;
        const value = checkbox.dataset.traitValue;
        if (!selectedTraits[type]) selectedTraits[type] = [];
        selectedTraits[type].push(value);
    });

    const baseIDs = isShowingClonesOnly ? Array.from(traitSignatures.cloneIds) : Object.keys(traitsData);

    let matchingNFTs = baseIDs.filter(id => {
        const nftTraits = traitsData[id];
        return Object.entries(selectedTraits).every(([traitType, selectedValues]) =>
            selectedValues.includes(getTraitName(nftTraits[traitType]))
        );
    });

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

    filteredNFTIds = getSortedNFTIds(matchingNFTs);
    isFiltering = true;

    if (isShowingClonesOnly) { filterClones(); return; }

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

        if (isShowingClonesOnly)          preserveScroll(() => { filterClones(); updateURL(); });
        else if (isShowingListingOnly)    preserveScroll(() => { filterListing(); updateURL(); });
        else if (hasActiveStatFilters())  preserveScroll(() => { filterByTraits(); updateURL(); });
        else                              preserveScroll(() => { allNFTIds = getSortedNFTIds(Object.keys(traitsData)); loadInitialNFTs(); updateURL(); });
        return;
    }

    updateURL();
    preserveScroll(() => filterByTraits());
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
        const slider = control.querySelector('input[type="range"]');
        const valueDisplay = control.querySelector('.stat-control-input-value');
        const toggleInput = control.querySelector('.toggle-input');
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

    const isNew = metadataInfo.kamiNewWindow && Object.prototype.hasOwnProperty.call(metadataInfo.kamiNewWindow, String(id));
    const isClone = traitSignatures.cloneIds.has(id);
    const isSacrificed = sacrificedNFTs.has(String(id));
    const listingPrice = listingNFTs.get(String(id));
    const isListing = listingPrice !== undefined;

    const card = document.createElement('div');
    card.className = 'nft-card hover_wrapper';
    card.dataset.nftId = id;

    let rankClass = 'rank-common';
    const totalNFTs = Object.keys(traitsData).length;
    const rankPercentile = (rank / totalNFTs) * 100;
    if (rankPercentile <= 1)       rankClass = 'rank-legendary';
    else if (rankPercentile <= 5)  rankClass = 'rank-epic';
    else if (rankPercentile <= 15) rankClass = 'rank-rare';
    else if (rankPercentile <= 40) rankClass = 'rank-uncommon';

    const statColorClass = getStatColorClass();
    const statValue = stats?.stats[currentSortOrder] || '';
    const rankTooltip = isTied
        ? `Rank: #${rank} (Tied) | Score: ${score}`
        : `Rank: #${rank} | Score: ${score}`;

    const closeButtonHTML = showCloseButton
        ? `<button class="close-btn" onclick="removeSelectedID('${id}')" title="Remove this Kamigotchi">×</button>` : '';
    const newBadgeHTML = isNew
        ? `<div class="new-badge" title="Recently Added!">NEW</div>` : '';
    const cloneBadgeHTML = isClone
        ? `<div class="clone-badge" title="This Kamigotchi has identical traits to others">CLONE</div>` : '';
    const sacrificeBadgeHTML = isSacrificed
        ? `<div class="sacrifice-badge" title="This Kamigotchi has been sacrificed">🕳️</div>` : '';
    const listingBadgeHTML = isListing
        ? `<div class="listing-badge"><img id="kamiswap_icon" src="https://app.kamigotchi.io/assets/marketplace-BqMKbOFC.png" style="border:none"></div>` : '';
    const listingPriceHTML = isListing
        ? `<div class="listing-price">Ξ${listingPrice}</div>` : '';
    const statColorHTML = statColorClass
        ? `<div class="stat-color-box ${statColorClass}" title="${statColorClass.charAt(0).toUpperCase() + statColorClass.slice(1)} Sort">${statValue}</div>` : '';

    const statsHTML = stats ? `
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

    const traitsHTML = Object.entries(traits)
        .map(([key, traitData]) => `
            <div class="trait">
                <p>${key.charAt(0).toUpperCase() + key.slice(1)}: ${getTraitName(traitData)}</p>
            </div>`)
        .join('');

    const rankBadge = `
        <div class="rank-stat-container">
            <div class="rank-badge ${rankClass}" title="${rankTooltip}">${rank}</div>
            ${statColorHTML}
        </div>`;

    const imageBlock = `
        <div class="image-container">
            <img src="${imageUrl}" alt="NFT #${id}" loading="lazy" onerror="this.src='https://via.placeholder.com/250?text=Not+Found'">
            ${sacrificeBadgeHTML}
            ${listingBadgeHTML}
            ${listingPriceHTML}
        </div>`;

    // On mobile, stats render inside the details panel; on desktop they sit above the image block
    if (isMobile) {
        card.innerHTML = `
            ${closeButtonHTML}${newBadgeHTML}${cloneBadgeHTML}
            ${rankBadge}
            <div class="nft-card-content">
                ${imageBlock}
                <div class="nft-details hover_wrapper">
                    <div class="nft-id">Kamigotchi ${id}</div>
                    ${traitsHTML}
                    ${statsHTML}
                </div>
            </div>`;
    } else {
        card.innerHTML = `
            ${closeButtonHTML}${newBadgeHTML}${cloneBadgeHTML}
            ${rankBadge}
            ${statsHTML}
            <div class="nft-card-content">
                ${imageBlock}
                <div class="nft-details hover_wrapper">
                    <div class="nft-id">Kamigotchi ${id}</div>
                    ${traitsHTML}
                </div>
            </div>`;
    }

    card.addEventListener('click', (event) => {
        event.stopPropagation();
        card.querySelector('.kami-stats')?.classList.toggle('is-active');
    });

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

        // Re-observe the new last card for infinite scroll triggering
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
        <div class="note">** dear mobile user, click card to show og stats **</div>
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
    getSortedNFTIds(Array.from(selectedIDs)).forEach(id => {
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

    if (!id) { showMessage('Please enter an NFT ID'); return; }
    if (!imagesData[id] || !traitsData[id]) { showMessage(`Kamigotchi #${id} not found. Please check the ID and try again.`); return; }
    if (selectedIDs.has(id)) { showMessage(`Kamigotchi #${id} is already added!`); return; }

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
    } catch (err) {
        // Silent fail
    }
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
            listingNFTs = new Map(Object.entries(data).map(([id, price]) => [String(id), price]));
            console.log(`🛍️ Loaded ${listingNFTs.size} listing Kamigotchi on KamiSwap`);
        }
    } catch (err) {
        // Silent fail — listing badges simply won't show if unavailable
    }
}

function getSignificantMetaHash(meta) {
    // Exclude lastUpdate and extractionDuration — these change every run regardless
    return JSON.stringify({
        previousMaxId: meta.previousMaxId,
        newKamiIds:    meta.newKamiIds,
        kamiNewWindow: meta.kamiNewWindow,
        totalCount:    meta.totalCount,
    });
}

async function checkForUpdates() {
    try {
        const v = Math.floor(Date.now() / (5 * 60 * 1000)); // aligns to 5-min windows
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.');
        const baseUrl = isLocal ? 'https://data.kami.h80h.xyz' : '/api/data';

        // Fetch both files in parallel
        const [listingsRes, metaRes] = await Promise.all([
            fetch(`${baseUrl}/kamiListings.json?v=${v}`),
            fetch(`${baseUrl}/kamiMeta.json?v=${v}`),
        ]);

        let shouldRefresh = false;

        if (listingsRes.ok) {
            const newListings = await listingsRes.json();
            const newHash = JSON.stringify(newListings);
            if (cachedListingsHash && newHash !== cachedListingsHash) {
                console.log('🛍️ Listings changed, refreshing all data...');
                shouldRefresh = true;
            }
            cachedListingsHash = newHash;
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

    } catch (err) {
        // silent fail
    }
}

function startAutoRefresh() {
    setInterval(checkForUpdates, 5 * 60 * 1000);
}

// Fetches kamiBundle.json, splits it into global data stores, then nulls the bundle for GC
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

    imagesData     = bundle.kamiImage;    bundle.kamiImage    = null;
    traitsData     = bundle.kamiTraits;   bundle.kamiTraits   = null;
    kamiStatsData  = bundle.kamiStats  || {};  bundle.kamiStats    = null;
    metadataInfo   = bundle.kamiMetadata || { newKamiIds: [] }; bundle.kamiMetadata = null;
    bundle = null;
}

// Post-fetch data processing shared by loadData and refreshData
function processLoadedData() {
    affinityData       = extractAffinityData();
    traitAffinityLookup = buildTraitAffinityLookup();
    traitSignatures    = buildTraitSignatures();
    traitCounts        = calculateTraitCounts();
    nftRarityScores    = calculateRarityScores();
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
        ]);

        if (Object.keys(kamiStatsData).length > 0) {
            console.log(`✅ Loaded stats data for ${Object.keys(kamiStatsData).length} Kamigotchi`);
        }
        if (metadataInfo.newKamiIds?.length > 0) {
            console.log(`✨ Found ${metadataInfo.newKamiIds.length} new Kamigotchi!`);
            console.log(`   New IDs: ${metadataInfo.newKamiIds.join(', ')}`);
        }

        processLoadedData();

        // Wire up all controls
        setupSortButtons();
        setupCloneFilterButton();
        setupListingFilterButton();
        setupAffinityFilterToggle();
        setupMinMaxFilterToggle();
        setupAffinityFilters();
        createFilterControls();

        // Restore URL state
        const initialFilterActive = loadStateFromURL();

        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.sort-btn[data-sort="${currentSortOrder}"]`)?.classList.add('active');
        document.getElementById('cloneFilterBtn')?.classList.toggle('active', isShowingClonesOnly);
        document.getElementById('listingFilterBtn')?.classList.toggle('active', isShowingListingOnly);

        updateSelectedIDsDisplay();
        allNFTIds = getSortedNFTIds();

        if (initialFilterActive)      filterByTraits();
        else if (isShowingClonesOnly) filterClones();
        else if (isShowingListingOnly) filterListing();
        else                           loadInitialNFTs();

        updateURL(true);

        // Update refresh button tooltip with last updated time
        const now = new Date();
        const label = `Last updated:\n${now.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${now.toLocaleTimeString()}`;
        document.getElementById('refreshDataBtn')?.setAttribute('data-tooltip', label);

        // Seed hashes and begin polling for changes every 5 min
        cachedListingsHash = JSON.stringify(Object.fromEntries(listingNFTs));
        cachedMetaHash = getSignificantMetaHash(metadataInfo);
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

    const refreshBtn = document.getElementById('refreshDataBtn');
    const originalText = refreshBtn.innerHTML;
    refreshBtn.disabled = true;

    try {
        console.log('🔄 Refreshing data...');

        // Snapshot current UI state before re-fetch
        const currentFilters = getTraitStringFromState();
        const currentSort = currentSortOrder;
        const wasShowingClones = isShowingClonesOnly;
        const wasShowingListing = isShowingListingOnly;

        const v = Date.now();
        await Promise.all([
            fetchAndSplitBundle(v),
            loadSacrificeData(v),
            loadListingsData(v),
        ]);

        if (Object.keys(kamiStatsData).length > 0) {
            console.log(`✅ Re-loaded stats data for ${Object.keys(kamiStatsData).length} Kamigotchi`);
        }
        console.log(metadataInfo.newKamiIds?.length > 0
            ? `✨ Found ${metadataInfo.newKamiIds.length} new Kamigotchi! IDs: ${metadataInfo.newKamiIds.join(', ')}`
            : '💤 No new Kamigotchi'
        );

        processLoadedData();

        // Restore UI state
        currentSortOrder = currentSort;
        isShowingClonesOnly = wasShowingClones;
        isShowingListingOnly = wasShowingListing;
        allNFTIds = getSortedNFTIds();

        const filterControls = document.getElementById('filterControls');
        filterControls.innerHTML = '';
        createFilterControls();

        // Restore trait filter checkboxes via URL trick
        if (currentFilters) {
            const originalSearch = window.location.search;
            const params = new URLSearchParams();
            params.set('traits', currentFilters);
            history.replaceState(null, '', `?${params.toString()}`);
            loadStateFromURL();
            history.replaceState(null, '', originalSearch);
        }

        document.getElementById('cloneFilterBtn')?.classList.toggle('active', isShowingClonesOnly);
        document.getElementById('listingFilterBtn')?.classList.toggle('active', isShowingListingOnly);

        preserveScroll(() => {
            if (isShowingClonesOnly)       filterClones();
            else if (isShowingListingOnly) filterListing();
            else if (currentFilters)       filterByTraits();
            else                           { isFiltering = false; loadInitialNFTs(); }
        });

        updateURL(true);

        // Show checkmark feedback briefly
        refreshBtn.innerHTML = `<svg id="refreshComplete" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><mask id="SVGkzXYXbbR"><g fill="none" stroke="#fff" stroke-dasharray="24" stroke-dashoffset="24" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.4s" values="24;0"/></path><path stroke="#000" stroke-width="6" d="M7.5 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.4s" dur="0.4s" values="24;0"/></path><path d="M7.5 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.4s" dur="0.4s" values="24;0"/></path></g></mask><rect width="24" height="24" fill="currentColor" mask="url(#SVGkzXYXbbR)"/></svg>`;
        setTimeout(() => {
            refreshBtn.innerHTML = originalText;
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = '1';
            isRefreshing = false;
            // Update tooltip after originalText is restored (restoring innerHTML resets the SVG title)
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

// Immediate event wiring (safe at parse time — elements exist in the HTML)
document.getElementById('searchBtn').addEventListener('click', searchByID);
document.getElementById('searchInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') searchByID(); });
document.getElementById('clearSearchBtn').addEventListener('click', clearAllSelectedIDs);
document.getElementById('clearBtn').addEventListener('click', clearFilters);

document.addEventListener('DOMContentLoaded', () => {
    setupScrollToTop();
    setupRefreshButton();
    window.addEventListener('popstate', handlePopState);

    document.addEventListener('click', (e) => {
        // Close any open stats panel when clicking outside a card
        const openStats = document.querySelector('.kami-stats.is-active');
        if (openStats) {
            const parentCard = openStats.closest('.nft-card');
            if (parentCard && !parentCard.contains(e.target)) openStats.classList.remove('is-active');
        }

        // Close open trait filter dropdown when clicking outside filter controls
        const filterControls = document.getElementById('filterControls');
        if (filterControls && !filterControls.contains(e.target)) {
            document.querySelectorAll('.filter-group').forEach(group => group.style.display = 'none');
            const dropdown = document.getElementById('traitCategoryDropdown');
            if (dropdown) dropdown.value = '';
        }
    });
});

// Inject message-box styles and create the DOM element (replaces alert())
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

    // When .listing-badge is hovered, set sibling .listing-price opacity to 0.7
    document.addEventListener('mouseover', (e) => {
        if (e.target.closest('.listing-badge')) {
            const container = e.target.closest('.image-container');
            const price = container?.querySelector('.listing-price');
            if (price) price.style.opacity = '0.7';
        }
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('.listing-badge')) {
            const container = e.target.closest('.image-container');
            const price = container?.querySelector('.listing-price');
            if (price) price.style.opacity = '';
        }
    });
}

// Unregister any stale service workers
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(r => r.unregister());
    });
}

loadData();