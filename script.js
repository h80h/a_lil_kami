// BOT ARMOR — throttle duplicate requests to the database
let lastRequestTime = 0;

// ============================================================
// UMAMI ENGAGEMENT TRACKER
// ============================================================
(function () {
  try {
    const config = {
      id: "d7d7ed00-7944-425f-8a8c-552bf9916cc0",
      domains: "kami.h80h.xyz",
      host: "https://kami.h80h.xyz/stats",
      src: "/stats/script.js",
    };

    const tiers = {
      "just-checking": 2000,
      interested: 10000,
      engaged: 30000,
      "deep-dive": 120000,
      dedicated: 300000,
      "long-engagement": 600000,
    };

    if (window.location.hostname === "localhost" || navigator.webdriver) return;

    const el = document.createElement("script");
    Object.assign(el, { src: config.src, defer: true });
    el.setAttribute("data-website-id", config.id);
    el.setAttribute("data-domains", config.domains);
    el.setAttribute("data-host-url", config.host);
    el.setAttribute("data-auto-track", "false");
    document.head.appendChild(el);

    const getSessionVal = (key) => parseInt(sessionStorage.getItem(key) || "0");
    const setSessionVal = (key, val) =>
      sessionStorage.setItem(key, val.toString());

    let engagementInterval;
    let pageViewSent = false;
    let lastEventTime = 0;
    let totalActiveTime = getSessionVal("kami_active_ms");
    let heartbeatCount = getSessionVal("kami_hb_count");
    let lastInteractionTimestamp = 0;
    const MAX_HEARTBEATS = 5;

    window.startHonestTracking = () => {
      if (engagementInterval) return;

      let lastUrl = window.location.href;

      const watchFilters = (force = false) => {
        if (
          (window.location.href !== lastUrl || force) &&
          window.umami &&
          pageViewSent
        ) {
          lastUrl = window.location.href;
          const params = new URLSearchParams(window.location.search);
          const filterData = Object.fromEntries(params.entries());
          if (Object.keys(filterData).length > 0) {
            umami.track("filter-applied", filterData);
            lastInteractionTimestamp = Date.now();
          }
        }
      };

      window.addEventListener("popstate", () => watchFilters());
      const originalPush = history.pushState;
      history.pushState = function () {
        originalPush.apply(this, arguments);
        watchFilters();
      };

      document.addEventListener("visibilitychange", () => {
        if (window.umami && pageViewSent) {
          umami.track(
            document.visibilityState === "visible" ? "tab-focus" : "app-hidden",
          );
        }
      });

      engagementInterval = setInterval(() => {
        const now = Date.now();
        const isGracePeriod = totalActiveTime < 600000;
        const hasRecentInteraction = now - lastInteractionTimestamp < 300000;

        if (
          document.visibilityState === "visible" &&
          (isGracePeriod || hasRecentInteraction)
        ) {
          totalActiveTime += 1000;
          setSessionVal("kami_active_ms", totalActiveTime);

          for (const [name, ms] of Object.entries(tiers)) {
            const tierKey = "kami_tier_" + name;
            if (
              totalActiveTime >= ms &&
              sessionStorage.getItem(tierKey) !== "true"
            ) {
              if (window.umami) {
                if (!pageViewSent) {
                  umami.track();
                  pageViewSent = true;
                  if (window.location.search) watchFilters(true);
                }
                umami.track(name, { seconds: ms / 1000 });
                sessionStorage.setItem(tierKey, "true");
                lastEventTime = totalActiveTime;
              }
            }
          }

          if (
            totalActiveTime >= 600000 &&
            totalActiveTime - lastEventTime >= 240000
          ) {
            if (
              window.umami &&
              heartbeatCount < MAX_HEARTBEATS &&
              hasRecentInteraction
            ) {
              umami.track("heartbeat");
              heartbeatCount++;
              setSessionVal("kami_hb_count", heartbeatCount);
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
    if (!response.ok) throw new Error("Network error");

    const data = await response.json();
    const rawCount = data.count || 0;
    const countElement = document.getElementById("online-count");

    if (countElement) {
      const displayCount = rawCount > 0 ? rawCount : 1;
      countElement.innerText = displayCount;
      countElement.classList.add("visible");
    }
  } catch (err) {
    console.error("%c[!] Live Sync Interrupted.", "color: #ef4444;");
  }
}

// ============================================================
// GLOBAL STATE.
// ============================================================

let imagesData = {};
let traitsData = {};
let kamiStatsData = {};
let kamiTraitIndexData = {};
let traitNameToIndex = {};
let kamiInfoData = {};
let kamiToAccount = {}; // { [kamiIndex]: [accountName, accountIndex] } — pre-inverted by extractor
let _bundleKamiOwnerMap = {}; // temporary staging slot — freed after loadKamiInfoData assigns it
let kamiScoresData = {}; // { [kamiIndex]: [rarityScore, overallScore] } — from kamiScores
let kamiInGameRanks = {}; // { [kamiIndex]: rank } — computed client-side from kamiScoresData
let isShowingIngameRank = false; // global toggle: false = openrarity, true = in-game
let affinityData = {};
let metadataInfo = {};
let sacrificedNFTs = new Map(); // kami_index (string) → revealed_at_unix (number)
let wildNFTs = new Set();
let wildKamiOwners = {}; // { [kamiIndex]: { accountIndex, accountName } } — resolved server-side in GHA

let listingNFTs = new Map();
let listingMetaInfo = { newListingId: [], listingNewWindow: {} };

let cachedListingsHash = null;
let cachedListingsMetaHash = null;
let cachedMetaHash = null;
let cachedAccountsHash = null;

let traitSignatures = {};
let traitAffinityLookup = {};
let traitCounts = {};
let nftRarityScores = {};

let totalNFTsCount = 0; // cached after data loads — avoids Object.keys(traitsData).length on every card
let allNFTIds = [];
let filteredNFTIds = [];
let selectedIDs = new Set();
let currentLoadIndex = 0;
let currentSortOrder = "latest";
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
  health: { value: 50, isMax: false },
  power: { value: 10, isMax: false },
  violence: { value: 10, isMax: false },
  harmony: { value: 10, isMax: false },
  slots: { value: 0, isMax: false },
};

const INITIAL_LOAD_COUNT = 50;
const LAZY_LOAD_COUNT = 30;

let isMobile = window.innerWidth <= 390;
let _resizeTimer;
window.addEventListener(
  "resize",
  () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      isMobile = window.innerWidth <= 390;
    }, 150);
  },
  { passive: true },
);

// ============================================================
// URL SYNCHRONIZATION
// ============================================================

function getTraitStringFromState() {
  const checkboxes = document.querySelectorAll(".trait-checkbox:checked");
  const selected = {};

  checkboxes.forEach((checkbox) => {
    const type = checkbox.dataset.traitType;
    const value = checkbox.dataset.traitValue;

    let isCoveredByAffinity = false;
    if (type === "body" || type === "hand") {
      const affinitySet =
        type === "body" ? selectedBodyAffinities : selectedHandAffinities;
      const entry = lookupTrait(type, value);
      if (entry && affinitySet.has(entry.affinity)) isCoveredByAffinity = true;
    }

    if (!isCoveredByAffinity) {
      if (!selected[type]) selected[type] = [];
      selected[type].push(encodeURIComponent(value));
    }
  });

  return Object.entries(selected)
    .map(([type, values]) => `${type}:${values.join(",")}`)
    .join(";");
}

function getAffinityStringFromState() {
  const parts = [];
  if (selectedBodyAffinities.size > 0)
    parts.push(`body:${Array.from(selectedBodyAffinities).join(",")}`);
  if (selectedHandAffinities.size > 0)
    parts.push(`hand:${Array.from(selectedHandAffinities).join(",")}`);
  return parts.join(";");
}

function getMinMaxStringFromState() {
  const parts = [];
  Object.entries(statMinMaxFilters).forEach(([statName, filter]) => {
    if (!isStatFilterDefault(statName)) {
      parts.push(`${statName}:${filter.value}:${filter.isMax ? "max" : "min"}`);
    }
  });
  return parts.join(";");
}

function updateURL(replace = false) {
  const params = new URLSearchParams();
  if (currentSortOrder && currentSortOrder !== "latest")
    params.set("sort", currentSortOrder);

  const traitString = getTraitStringFromState();
  if (traitString) params.set("traits", traitString);

  const idArray = Array.from(selectedIDs).sort((a, b) => Number(a) - Number(b));
  if (idArray.length > 0) params.set("ids", idArray.join(","));

  if (isShowingClonesOnly) params.set("clones", "true");
  if (isShowingListingOnly) {
    params.set("listing", "true");
    if (currentListingSortOrder)
      params.set("listing-sort", currentListingSortOrder);
  }

  const affinityString = getAffinityStringFromState();
  if (affinityString) params.set("affinity", affinityString);

  const minMaxString = getMinMaxStringFromState();
  if (minMaxString) params.set("minmax", minMaxString);

  const queryString = params.toString();
  const newUrl = queryString
    ? `${window.location.pathname}?${queryString}${window.location.hash}`
    : `${window.location.pathname}${window.location.hash}`;

  if (replace) history.replaceState(null, "", newUrl);
  else history.pushState(null, "", newUrl);
}

function loadStateFromURL({ restorePanels = true } = {}) {
  const params = new URLSearchParams(window.location.search);
  let hasFilters = false;

  const urlSort = params.get("sort");
  if (urlSort) currentSortOrder = urlSort;

  const urlIDs = params.get("ids");
  if (urlIDs)
    selectedIDs = new Set(
      urlIDs
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    );

  isShowingClonesOnly = params.get("clones") === "true";
  isShowingListingOnly = params.get("listing") === "true";

  const urlListingSort = params.get("listing-sort");
  currentListingSortOrder =
    isShowingListingOnly && urlListingSort ? urlListingSort : null;

  const urlTraits = params.get("traits");
  if (urlTraits) {
    urlTraits.split(";").forEach((group) => {
      const [type, valuesString] = group.split(":");
      if (type && valuesString) {
        valuesString
          .split(",")
          .map((v) => decodeURIComponent(v))
          .forEach((value) => {
            const checkbox = document.querySelector(
              `.trait-checkbox[data-trait-type="${type}"][data-trait-value="${value}"]`,
            );
            if (checkbox) {
              checkbox.checked = true;
              hasFilters = true;
            }
          });
      }
    });
  }

  const urlAffinity = params.get("affinity");
  if (urlAffinity) {
    urlAffinity.split(";").forEach((group) => {
      const [type, valuesString] = group.split(":");
      if (type && valuesString) {
        valuesString.split(",").forEach((affinityValue) => {
          if (type === "body") selectedBodyAffinities.add(affinityValue);
          else if (type === "hand") selectedHandAffinities.add(affinityValue);

          Object.values(traitsData).forEach((nft) => {
            const traitName = nft[type]; // now a plain string
            if (traitName) {
              const entry = lookupTrait(type, traitName);
              if (entry && entry.affinity === affinityValue) {
                const cb = document.querySelector(
                  `.trait-checkbox[data-trait-type="${type}"][data-trait-value="${traitName}"]`,
                );
                if (cb) cb.checked = true;
              }
            }
          });
        });
        hasFilters = true;
      }
    });

    if (restorePanels) {
      const affinitySection = document.querySelector(
        ".affinity-filter-section",
      );
      const toggleBtn = document.getElementById("affinityFilterToggle");
      if (affinitySection) affinitySection.style.display = "block";
      if (toggleBtn) toggleBtn.classList.add("active");
    }
    updateAffinityButtonStates();
  }

  const urlMinMax = params.get("minmax");
  if (urlMinMax) {
    urlMinMax.split(";").forEach((part) => {
      const [statName, value, mode] = part.split(":");
      if (statName && value && statMinMaxFilters[statName] !== undefined) {
        const isMax = mode === "max";
        statMinMaxFilters[statName].value = Number(value);
        statMinMaxFilters[statName].isMax = isMax;

        const slider = document.querySelector(
          `.stat-control.${statName} .stat-control-input`,
        );
        const valueDisplay = document.querySelector(
          `.stat-control.${statName} .stat-control-input-value`,
        );
        const toggleInput = document.querySelector(
          `.stat-control.${statName} .toggle-input`,
        );
        if (slider) slider.value = value;
        if (valueDisplay) valueDisplay.textContent = value;
        if (toggleInput) toggleInput.checked = isMax;
      }
    });

    if (restorePanels) {
      const minmaxSection = document.querySelector(".minmax-filter-section");
      const toggleBtn = document.getElementById("minmaxFilterToggle");
      if (minmaxSection) minmaxSection.style.display = "block";
      if (toggleBtn) toggleBtn.classList.add("active");
    }
    hasFilters = true;
  }

  return hasFilters;
}

function handlePopState() {
  const hasFilters = loadStateFromURL();

  updateSelectedIDsDisplay();
  document
    .querySelectorAll(".sort-btn")
    .forEach((b) => b.classList.remove("active"));
  if (!currentListingSortOrder) {
    document
      .querySelector(`.sort-btn[data-sort="${currentSortOrder}"]`)
      ?.classList.add("active");
  }

  document
    .querySelectorAll(".listing-sort-btn")
    .forEach((b) => b.classList.remove("active"));
  if (currentListingSortOrder) {
    document
      .querySelector(
        `.listing-sort-btn[listing-data-sort="${currentListingSortOrder}"]`,
      )
      ?.classList.add("active");
  }

  document
    .getElementById("cloneFilterBtn")
    ?.classList.toggle("active", isShowingClonesOnly);
  document
    .getElementById("listingFilterBtn")
    ?.classList.toggle("active", isShowingListingOnly);

  if (isShowingClonesOnly) filterClones();
  else if (isShowingListingOnly) filterListing();
  else if (hasFilters) filterByTraits();
  else {
    isFiltering = false;
    allNFTIds = getSortedNFTIds();
    loadInitialNFTs();
  }
}

// ============================================================
// LOADER / CONTAINER DISPLAY
// ============================================================

function showLoader() {
  const loader = document.querySelector(".loader");
  loader.style.display = "block";
  loader.style.opacity = "1";
}

function hideLoader() {
  const loader = document.querySelector(".loader");
  loader.style.opacity = "0";
  if (typeof window.startHonestTracking === "function")
    window.startHonestTracking();
  setTimeout(() => {
    updateLiveStatus();
    loader.style.display = "none";
  }, 300);
  if (!window.liveStatusInterval)
    window.liveStatusInterval = setInterval(updateLiveStatus, 60000);
}

function showContainer() {
  const container = document.querySelector(".container");
  container.style.display = "block";
  setTimeout(() => {
    container.style.opacity = "1";
  }, 50);
}

// ============================================================
// DATA HELPERS
// ============================================================

function getTraitName(traitData) {
  return typeof traitData === "string" ? traitData : traitData.name;
}

function createTraitSignature(traits) {
  return Object.keys(traits)
    .sort()
    .map((category) => `${category}:${getTraitName(traits[category])}`)
    .join("|");
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
  Object.values(groups).forEach((ids) => {
    if (ids.length > 1) ids.forEach((id) => cloneIds.add(id));
  });

  return { signatures, groups, cloneIds };
}

function calculateTraitCounts() {
  const counts = {};
  Object.values(traitsData).forEach((nft) => {
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
  const totalNFTs = totalNFTsCount || Object.keys(traitsData).length;
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

  const expectedIx =
    Object.values(scores).reduce((sum, ix) => sum + ix, 0) / totalNFTs;
  Object.keys(scores).forEach((id) => {
    scores[id] = scores[id] / expectedIx;
  });

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
      isTied:
        tieCount > 0 ||
        (index < sortedByScore.length - 1 &&
          sortedByScore[index + 1][1] === score),
    };
    previousScore = score;
  });

  return rankedScores;
}

function buildTraitAffinityLookup() {
  // body/hand slot → { traitName: affinity } — sourced from kamiTraitIndex via name lookup
  const lookup = { body: {}, hand: {} };
  Object.values(traitsData).forEach((nft) => {
    ["body", "hand"].forEach((type) => {
      const traitName = nft[type]; // now a plain string
      if (traitName) {
        const entry = lookupTrait(type, traitName);
        if (entry && entry.affinity) lookup[type][traitName] = entry.affinity;
      }
    });
  });
  return lookup;
}

function extractAffinityData() {
  const affinities = {};
  Object.entries(traitsData).forEach(([id, traits]) => {
    const bodyEntry = traits.body ? lookupTrait("body", traits.body) : null;
    const handEntry = traits.hand ? lookupTrait("hand", traits.hand) : null;
    affinities[id] = {
      body: bodyEntry?.affinity || "NORMAL",
      hand: handEntry?.affinity || "NORMAL",
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
      case "rarity":
        return nftRarityScores[id]?.rank || 9999;
      case "harmony":
        return kamiStatsData[id]?.stats.harmony || 0;
      case "health":
        return kamiStatsData[id]?.stats.health || 0;
      case "power":
        return kamiStatsData[id]?.stats.power || 0;
      case "violence":
        return kamiStatsData[id]?.stats.violence || 0;
      default:
        return 0;
    }
  };

  if (currentSortOrder === "latest" || currentSortOrder === "oldest") {
    if (isShowingClonesOnly) {
      const repId = {};
      ids.forEach((id) => {
        const sig = traitSignatures.signatures[id];
        const num = Number(id);
        if (!repId[sig]) {
          repId[sig] = num;
        } else {
          repId[sig] =
            currentSortOrder === "latest"
              ? Math.max(repId[sig], num)
              : Math.min(repId[sig], num);
        }
      });
      return ids.sort((a, b) => {
        const sigA = traitSignatures.signatures[a];
        const sigB = traitSignatures.signatures[b];
        if (sigA !== sigB) {
          return currentSortOrder === "latest"
            ? repId[sigB] - repId[sigA]
            : repId[sigA] - repId[sigB];
        }
        return currentSortOrder === "latest"
          ? Number(b) - Number(a)
          : Number(a) - Number(b);
      });
    }
    return ids.sort((a, b) =>
      currentSortOrder === "latest"
        ? Number(b) - Number(a)
        : Number(a) - Number(b),
    );
  }

  return ids.sort((a, b) => {
    const sigA = traitSignatures.signatures[a];
    const sigB = traitSignatures.signatures[b];

    if (sigA !== sigB) {
      const statA = getStatValue(a);
      const statB = getStatValue(b);
      if (statA !== statB)
        return currentSortOrder === "rarity" ? statA - statB : statB - statA;
      const repA = Math.max(...traitSignatures.groups[sigA].map(Number));
      const repB = Math.max(...traitSignatures.groups[sigB].map(Number));
      return repB - repA;
    }

    return Number(b) - Number(a);
  });
}

function getSortedListingIds(ids) {
  if (!ids || ids.length === 0) return [];

  return ids.sort((a, b) => {
    const itemA = listingNFTs.get(String(a));
    const itemB = listingNFTs.get(String(b));

    if (currentListingSortOrder === "price") {
      const priceA = itemA?.price ?? Infinity;
      const priceB = itemB?.price ?? Infinity;
      if (priceA !== priceB) return priceA - priceB;
      return (
        new Date(itemB?.listedTime ?? 0).getTime() -
        new Date(itemA?.listedTime ?? 0).getTime()
      );
    }

    if (currentListingSortOrder === "recent") {
      const tsA = new Date(itemA?.listedTime ?? 0).getTime();
      const tsB = new Date(itemB?.listedTime ?? 0).getTime();
      if (tsA !== tsB) return tsB - tsA;
      return (itemA?.price ?? Infinity) - (itemB?.price ?? Infinity);
    }

    return Number(b) - Number(a);
  });
}

// ============================================================
// FILTER HELPERS
// ============================================================

function isStatFilterDefault(statName) {
  const f = statMinMaxFilters[statName];
  const slider = document.querySelector(
    `.stat-control.${statName} .stat-control-input`,
  );
  if (!slider) return true;
  return f.isMax
    ? f.value >= Number(slider.max)
    : f.value <= Number(slider.min);
}

function hasActiveStatFilters() {
  return Object.keys(statMinMaxFilters).some((s) => !isStatFilterDefault(s));
}

function passesStatMinMaxFilters(id) {
  const kamiData = kamiStatsData[id];
  for (const [statName, filter] of Object.entries(statMinMaxFilters)) {
    if (isStatFilterDefault(statName)) continue;
    const statVal = kamiData ? (kamiData.stats?.[statName] ?? 0) : 0;
    if (filter.isMax ? statVal > filter.value : statVal < filter.value)
      return false;
  }
  return true;
}

// Returns { traitType: [values] } for all currently checked trait checkboxes
function getSelectedTraitsFromCheckboxes() {
  const selectedTraits = {};
  document.querySelectorAll(".trait-checkbox:checked").forEach((cb) => {
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
    selectedValues.includes(getTraitName(nftTraits[traitType])),
  );
}

const AFFINITY_MAP = { NORMAL: "N", INSECT: "I", SCRAP: "S", EERIE: "E" };

function getAffinityNotation() {
  if (selectedBodyAffinities.size === 0 && selectedHandAffinities.size === 0)
    return "";
  const bChar = AFFINITY_MAP[Array.from(selectedBodyAffinities)[0]] || "";
  const hChar = AFFINITY_MAP[Array.from(selectedHandAffinities)[0]] || "";
  return ` (${bChar}/${hChar})`;
}

function buildTraitSummaryButtonsHTML(selectedTraits) {
  return Object.entries(selectedTraits)
    .flatMap(([type, values]) =>
      values.map(
        (value) => `
            <button class="count-header-trait-btn" data-trait-type="${type}" data-trait-value="${value}"
                    title="Click to remove filter: ${type}: ${value}">
                ${type}: ${value} ×
            </button>`,
      ),
    )
    .join("");
}

function buildStatFilterSummaryHTML() {
  let html = "";
  Object.entries(statMinMaxFilters).forEach(([statName, filter]) => {
    if (isStatFilterDefault(statName)) return;
    const op = filter.isMax ? "&lt;=" : "&gt;=";
    html += `<button class="count-header-trait-btn stat-filter-summary-btn" data-stat-name="${statName}">
                    ${statName} ${op} ${filter.value} ×
                 </button>`;
  });
  return html
    ? `<div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">${html}</div>`
    : "";
}

function attachStatFilterSummaryListeners(container) {
  container.querySelectorAll(".stat-filter-summary-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const statName = btn.dataset.statName;
      const slider = document.querySelector(
        `.stat-control.${statName} .stat-control-input`,
      );
      const valueDisplay = document.querySelector(
        `.stat-control.${statName} .stat-control-input-value`,
      );
      const toggleInput = document.querySelector(
        `.stat-control.${statName} .toggle-input`,
      );
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

function appendCountHeader(resultsDiv, summaryText, filterSummaryHTML = "") {
  const countDiv = document.createElement("div");
  countDiv.className = "count-header";
  countDiv.innerHTML = `
        <div id="count-summary" style="font-size: 14px;">${summaryText}</div>
        <div class="note">** click the lil arrow on card for og stats and more info **</div>
        ${filterSummaryHTML}
        ${buildStatFilterSummaryHTML()}
    `;
  resultsDiv.appendChild(countDiv);
  attachStatFilterSummaryListeners(countDiv);
  countDiv
    .querySelectorAll(".count-header-trait-btn:not(.stat-filter-summary-btn)")
    .forEach((btn) => {
      btn.addEventListener("click", removeSelectedTrait);
    });
  return countDiv;
}

function restoreViewAfterToggle() {
  const hasAffinityFilters =
    selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;
  if (isFiltering || hasAffinityFilters)
    preserveScroll(() => {
      filterByTraits();
      updateURL();
    });
  else
    preserveScroll(() => {
      allNFTIds = getSortedNFTIds();
      loadInitialNFTs();
      updateURL();
    });
}

// ============================================================
// SETUP — SORT & FILTER BUTTON WIRING
// ============================================================

function setupSortButtons() {
  const sortButtons = document.querySelectorAll(".sort-btn");
  sortButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const newSort = e.target.dataset.sort;
      if (newSort === currentSortOrder && currentListingSortOrder === null)
        return;

      if (currentListingSortOrder !== null) {
        currentListingSortOrder = null;
        document
          .querySelectorAll(".listing-sort-btn")
          .forEach((b) => b.classList.remove("active"));
      }

      currentSortOrder = newSort;
      sortButtons.forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");

      if (
        isShowingClonesOnly &&
        !(isShowingListingOnly && currentListingSortOrder)
      )
        preserveScroll(() => filterClones());
      else if (isShowingListingOnly) preserveScroll(() => filterListing());
      else if (isFiltering) preserveScroll(() => filterByTraits());
      else
        preserveScroll(() => {
          allNFTIds = getSortedNFTIds();
          loadInitialNFTs();
        });

      if (selectedIDs.size > 0) updateSelectedIDsDisplay();
      updateURL();
    });
  });
}

function setupCloneFilterButton() {
  const cloneBtn = document.getElementById("cloneFilterBtn");
  if (!cloneBtn) return;

  cloneBtn.addEventListener("click", () => {
    isShowingClonesOnly = !isShowingClonesOnly;
    cloneBtn.classList.toggle("active", isShowingClonesOnly);

    if (window.__tradeHistoryActive) return;
    if (isShowingClonesOnly)
      preserveScroll(() => {
        filterClones();
        updateURL();
      });
    else if (isShowingListingOnly)
      preserveScroll(() => {
        filterListing();
        updateURL();
      });
    else restoreViewAfterToggle();
  });
}

function setupListingFilterButton() {
  const listingBtn = document.getElementById("listingFilterBtn");
  if (!listingBtn) return;

  listingBtn.addEventListener("click", () => {
    isShowingListingOnly = !isShowingListingOnly;
    listingBtn.classList.toggle("active", isShowingListingOnly);

    const listingSortSection = document.querySelector(".listing-sort-section");
    if (listingSortSection)
      listingSortSection.style.display = isShowingListingOnly
        ? "block"
        : "none";

    if (!isShowingListingOnly) {
      currentListingSortOrder = null;
      document
        .querySelectorAll(".listing-sort-btn")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(".sort-btn")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelector(`.sort-btn[data-sort="${currentSortOrder}"]`)
        ?.classList.add("active");
    }

    if (isShowingListingOnly)
      preserveScroll(() => {
        filterListing();
        updateURL();
      });
    else if (isShowingClonesOnly)
      preserveScroll(() => {
        filterClones();
        updateURL();
      });
    else restoreViewAfterToggle();

    if (selectedIDs.size > 0) updateSelectedIDsDisplay();
  });
}

function setupListingSortButtons() {
  const listingSortBtns = document.querySelectorAll(".listing-sort-btn");
  listingSortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!isShowingListingOnly) return;

      const newListingSort = btn.getAttribute("listing-data-sort");
      if (newListingSort === currentListingSortOrder) return;

      listingSortBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentListingSortOrder = newListingSort;

      document
        .querySelectorAll(".sort-btn")
        .forEach((b) => b.classList.remove("active"));
      currentSortOrder = "latest";

      preserveScroll(() => {
        filterListing();
        updateURL();
      });

      if (selectedIDs.size > 0) updateSelectedIDsDisplay();
    });
  });
}

function setupAffinityFilterToggle() {
  const toggleBtn = document.getElementById("affinityFilterToggle");
  const affinitySection = document.querySelector(".affinity-filter-section");
  if (!toggleBtn || !affinitySection) return;

  toggleBtn.addEventListener("click", () => {
    const isVisible = affinitySection.style.display !== "none";
    affinitySection.style.display = isVisible ? "none" : "block";
    toggleBtn.classList.toggle("active", !isVisible);
  });
}

function setupMinMaxFilterToggle() {
  const toggleBtn = document.getElementById("minmaxFilterToggle");
  const minmaxSection = document.querySelector(".minmax-filter-section");
  if (!toggleBtn || !minmaxSection) return;

  toggleBtn.addEventListener("click", () => {
    const isVisible = minmaxSection.style.display !== "none";
    minmaxSection.style.display = isVisible ? "none" : "block";
    toggleBtn.classList.toggle("active", !isVisible);
  });
}

function setupAffinityFilters() {
  document.querySelectorAll(".affinity-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const affinityValue = button.textContent.trim();
      const isBody = button.closest("#bodyAffinity") !== null;
      const traitType = isBody ? "body" : "hand";
      const affinitySet = isBody
        ? selectedBodyAffinities
        : selectedHandAffinities;

      if (affinitySet.has(affinityValue)) {
        affinitySet.delete(affinityValue);
        button.classList.remove("active");
        toggleTraitCheckboxesByAffinity(traitType, affinityValue, false);
      } else {
        affinitySet.clear();
        document
          .querySelectorAll(`.trait-checkbox[data-trait-type="${traitType}"]`)
          .forEach((cb) => (cb.checked = false));
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
    const cb = document.querySelector(
      `.trait-checkbox[data-trait-type="${type}"][data-trait-value="${traitName}"]`,
    );
    if (cb) cb.checked = shouldCheck;
  });
}

function updateAffinityButtonStates() {
  document.querySelectorAll(".affinity-btn").forEach((button) => {
    const affinity = button.textContent.trim();
    const isBodyButton = button.closest("#bodyAffinity") !== null;
    button.classList.toggle(
      "active",
      isBodyButton
        ? selectedBodyAffinities.has(affinity)
        : selectedHandAffinities.has(affinity),
    );
  });
}

function removeSelectedAffinity(event) {
  const { affinityType, affinityValue } = event.currentTarget.dataset;
  if (affinityType === "body") selectedBodyAffinities.delete(affinityValue);
  else if (affinityType === "hand")
    selectedHandAffinities.delete(affinityValue);
  updateAffinityButtonStates();
  if (isShowingListingOnly)
    preserveScroll(() => {
      filterListing();
      updateURL();
    });
  else
    preserveScroll(() => {
      filterByTraits();
      updateURL();
    });
}

function validateAffinitiesAgainstCheckboxes() {
  let stateChanged = false;

  ["body", "hand"].forEach((type) => {
    const activeAffinities =
      type === "body" ? selectedBodyAffinities : selectedHandAffinities;
    const lookup = traitAffinityLookup[type] || {};

    const checkedTraitNames = Array.from(
      document.querySelectorAll(
        `.trait-checkbox[data-trait-type="${type}"]:checked`,
      ),
    ).map((cb) => cb.dataset.traitValue);

    const representedAffinities = new Set(
      checkedTraitNames.map((name) => lookup[name]).filter(Boolean),
    );

    if (representedAffinities.size === 1) {
      const currentAffinity = Array.from(representedAffinities)[0];
      const requiredTraits = Object.entries(lookup)
        .filter(([, aff]) => aff === currentAffinity)
        .map(([name]) => name);
      const checkedSet = new Set(checkedTraitNames);
      const isComplete = requiredTraits.every((name) => checkedSet.has(name));

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
const controls = document.querySelectorAll(".stat-control");
controls.forEach((control) => {
  const statName = ["health", "power", "violence", "harmony", "slots"].find(
    (s) => control.classList.contains(s),
  );
  const slider = control.querySelector('input[type="range"]');
  const valueDisplay = control.querySelector(".stat-control-input-value");
  const toggleInput = control.querySelector(".toggle-input");

  if (statName && slider) {
    statMinMaxFilters[statName].value = Number(slider.value);
    statMinMaxFilters[statName].isMax = toggleInput
      ? toggleInput.checked
      : false;
  }

  slider.addEventListener("input", (event) => {
    valueDisplay.textContent = event.target.value;
    if (statName) {
      statMinMaxFilters[statName].value = Number(event.target.value);
      triggerStatFilter();
    }
  });

  if (toggleInput && statName) {
    toggleInput.addEventListener("change", () => {
      statMinMaxFilters[statName].isMax = toggleInput.checked;
      triggerStatFilter();
    });
  }
});

let _statFilterTimer = null;
function triggerStatFilter() {
  clearTimeout(_statFilterTimer);
  _statFilterTimer = setTimeout(() => {
    if (
      window.__tradeHistoryActive &&
      typeof window._filterTradeHistory === "function"
    ) {
      window._filterTradeHistory();
      return;
    }
    preserveScroll(() => {
      if (
        isShowingClonesOnly &&
        !(isShowingListingOnly && currentListingSortOrder)
      )
        filterClones();
      else if (isShowingListingOnly) filterListing();
      else if (isFiltering || hasActiveStatFilters()) filterByTraits();
      else {
        allNFTIds = getSortedNFTIds(Object.keys(traitsData));
        loadInitialNFTs();
      }
      updateURL();
    });
  }, 200);
}

function preserveScroll(fn) {
  const scrollY = window.scrollY;
  fn();
  // Re-assert scroll position across several frames to survive async DOM re-renders
  const restore = () => {
    if (window.scrollY !== scrollY)
      window.scrollTo({ top: scrollY, behavior: "instant" });
  };
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });
  setTimeout(restore, 50);
  setTimeout(restore, 150);
}

// ============================================================
// FILTER CONTROLS UI
// ============================================================

function createFilterControls() {
  const filterControls = document.getElementById("filterControls");
  const allTraits = {};
  const traitDetails = {};

  Object.values(traitsData).forEach((nft) => {
    Object.entries(nft).forEach(([traitType, traitData]) => {
      if (!allTraits[traitType]) {
        allTraits[traitType] = new Set();
        traitDetails[traitType] = {};
      }
      const traitName = getTraitName(traitData);
      allTraits[traitType].add(traitName);
      if (!traitDetails[traitType][traitName]) {
        const indexEntry = lookupTrait(traitType, traitName) || {};
        traitDetails[traitType][traitName] = {
          affinity: indexEntry.affinity || null,
          stats: indexEntry.stats || {},
        };
      }
    });
  });

  const dropdownWrapper = document.createElement("div");
  dropdownWrapper.className = "dropdown-wrapper";
  const dropdownLabel = document.createElement("label");
  dropdownLabel.textContent = "Select Trait Category:";
  dropdownLabel.className = "dropdown-label";

  // Custom dropdown replacing native <select> for consistent styling
  const dropdown = document.createElement("div");
  dropdown.id = "traitCategoryDropdown";
  dropdown.className = "trait-dropdown custom-select";
  dropdown.dataset.value = "";

  const customSelected = document.createElement("div");
  customSelected.className = "custom-select__selected";

  const customSelectedText = document.createElement("span");
  customSelectedText.textContent = "-- Choose a category --";

  const customArrow = document.createElement("span");
  customArrow.className = "custom-select__arrow";
  customArrow.innerHTML = `<svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  customSelected.appendChild(customSelectedText);
  customSelected.appendChild(customArrow);

  const customOptions = document.createElement("div");
  customOptions.className = "custom-select__options";

  // Only real category options — no duplicate placeholder in the list
  Object.keys(allTraits)
    .sort()
    .forEach((traitType) => {
      const item = document.createElement("div");
      item.className = "custom-select__option";
      item.dataset.value = traitType;
      item.textContent = traitType.charAt(0).toUpperCase() + traitType.slice(1);
      customOptions.appendChild(item);
    });

  dropdown.appendChild(customSelected);
  dropdown.appendChild(customOptions);

  customSelected.addEventListener("click", (e) => {
    const isOpen = dropdown.classList.toggle("custom-select--open");
    customOptions.style.display = isOpen ? "block" : "none";
  });

  customOptions.addEventListener("click", (e) => {
    const item = e.target.closest(".custom-select__option");
    if (!item) return;
    const value = item.dataset.value;
    dropdown.dataset.value = value;
    customSelectedText.textContent = value
      ? item.textContent
      : "-- Choose a category --";
    dropdown.classList.remove("custom-select--open");
    customOptions.style.display = "none";

    document
      .querySelectorAll(".filter-group")
      .forEach((group) => (group.style.display = "none"));
    if (value) {
      const selectedGroup = document.querySelector(
        `.filter-group[data-trait-type="${value}"]`,
      );
      if (selectedGroup) selectedGroup.style.display = "block";
    }
  });

  dropdownWrapper.appendChild(dropdownLabel);
  dropdownWrapper.appendChild(dropdown);
  filterControls.appendChild(dropdownWrapper);

  const filterGroupsContainer = document.createElement("div");
  filterGroupsContainer.id = "filterGroupsContainer";
  filterControls.appendChild(filterGroupsContainer);

  const totalNFTs = totalNFTsCount;

  Object.keys(allTraits)
    .sort()
    .forEach((traitType) => {
      const filterGroup = document.createElement("div");
      filterGroup.className = "filter-group";
      filterGroup.dataset.traitType = traitType;
      filterGroup.style.display = "none";

      const header = document.createElement("div");
      header.className = "filter-header";
      header.textContent =
        traitType.charAt(0).toUpperCase() + traitType.slice(1);
      filterGroup.appendChild(header);

      const searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.className = "trait-search";
      searchInput.placeholder = `Search ${traitType}...`;
      searchInput.autocomplete = "off";
      searchInput.dataset.traitType = traitType;
      filterGroup.appendChild(searchInput);

      const checkboxContainer = document.createElement("div");
      checkboxContainer.className = "checkbox-container";
      checkboxContainer.dataset.traitType = traitType;

      const sortedValues = [...allTraits[traitType]].sort(
        (a, b) =>
          (traitCounts[traitType][a] || 0) - (traitCounts[traitType][b] || 0),
      );

      sortedValues.forEach((value) => {
        const count = traitCounts[traitType][value] || 0;
        const percentage = ((count / totalNFTs) * 100).toFixed(1);
        const details = traitDetails[traitType][value] || {};

        const affinityHTML =
          details.affinity && (traitType === "body" || traitType === "hand")
            ? `<span class="trait-affinity ${details.affinity}">${details.affinity}</span>`
            : "";

        let statsHTML = "";
        if (details.stats && Object.keys(details.stats).length > 0) {
          const statBadges = Object.entries(details.stats)
            .map(([statName, val]) => {
              const sign = val > 0 ? "+" : "";
              return `<span class="trait-stat ${statName}">${statName.slice(0, 3).toUpperCase()} ${sign}${val}</span>`;
            })
            .join("");
          statsHTML = `<span class="trait-stats">${statBadges}</span>`;
        }

        const checkboxWrapper = document.createElement("label");
        checkboxWrapper.className = "checkbox-label";
        checkboxWrapper.dataset.traitValue = value.toLowerCase();

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "trait-checkbox";
        checkbox.dataset.traitType = traitType;
        checkbox.dataset.traitValue = value;
        checkbox.addEventListener("change", () =>
          updateSelectedTraitsDisplay(false),
        );

        const span = document.createElement("span");
        span.className = "trait-label-text";
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

      searchInput.addEventListener("input", (e) =>
        filterTraitOptions(traitType, e.target.value),
      );
    });
}

function filterTraitOptions(traitType, searchTerm) {
  const container = document.querySelector(
    `.checkbox-container[data-trait-type="${traitType}"]`,
  );
  const searchLower = searchTerm.toLowerCase().trim();
  let visibleCount = 0;

  container.querySelectorAll(".checkbox-label").forEach((label) => {
    const matches =
      searchLower === "" || label.dataset.traitValue.includes(searchLower);
    label.style.display = matches ? "flex" : "none";
    if (matches) visibleCount++;
  });

  let noResultsMsg = container.querySelector(".no-trait-results");
  if (visibleCount === 0) {
    if (!noResultsMsg) {
      noResultsMsg = document.createElement("div");
      noResultsMsg.className = "no-trait-results";
      noResultsMsg.textContent = "No matching traits found";
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
  const resultsDiv = document.getElementById("results");
  resultsDiv.textContent = "";

  const selectedTraits = getSelectedTraitsFromCheckboxes();
  const hasTraitFilters = Object.keys(selectedTraits).length > 0;
  const hasAffinityFilters =
    selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;

  let cloneIds = hasTraitFilters
    ? Array.from(traitSignatures.cloneIds).filter((id) =>
        matchesSelectedTraits(id, selectedTraits),
      )
    : Array.from(traitSignatures.cloneIds);

  if (hasAffinityFilters) {
    cloneIds = cloneIds.filter((id) => {
      const a = affinityData[id];
      return (
        a &&
        (selectedBodyAffinities.size === 0 ||
          selectedBodyAffinities.has(a.body)) &&
        (selectedHandAffinities.size === 0 ||
          selectedHandAffinities.has(a.hand))
      );
    });
  }
  if (hasActiveStatFilters())
    cloneIds = cloneIds.filter((id) => passesStatMinMaxFilters(id));
  if (isShowingListingOnly)
    cloneIds = cloneIds.filter((id) => listingNFTs.has(String(id)));

  filteredNFTIds =
    isShowingListingOnly && currentListingSortOrder
      ? getSortedListingIds(cloneIds)
      : getSortedNFTIds(cloneIds);
  isFiltering = true;

  const uniqueSignatures = new Set(
    cloneIds.map((id) => traitSignatures.signatures[id]),
  );
  const filterSummaryHTML = hasTraitFilters
    ? `<div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">${buildTraitSummaryButtonsHTML(selectedTraits)}</div>`
    : "";

  appendCountHeader(
    resultsDiv,
    `Found ${cloneIds.length} clones in ${uniqueSignatures.size} groups${getAffinityNotation()}`,
    filterSummaryHTML,
  );

  if (filteredNFTIds.length === 0) {
    const noResultsDiv = document.createElement("div");
    noResultsDiv.className = "no-results";
    noResultsDiv.textContent = "No clones found with current filters";
    resultsDiv.appendChild(noResultsDiv);
    return;
  }

  currentLoadIndex = 0;
  loadMoreNFTs();
  setupInfiniteScroll();
}

function filterListing() {
  const resultsDiv = document.getElementById("results");
  resultsDiv.textContent = "";

  const selectedTraits = getSelectedTraitsFromCheckboxes();
  const hasTraitFilters = Object.keys(selectedTraits).length > 0;
  const hasAffinityFilters =
    selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;

  let listingIds;
  if (isShowingClonesOnly) {
    const cloneBase = hasTraitFilters
      ? Array.from(traitSignatures.cloneIds).filter((id) =>
          matchesSelectedTraits(id, selectedTraits),
        )
      : Array.from(traitSignatures.cloneIds);
    listingIds = cloneBase.filter((id) => listingNFTs.has(String(id)));
  } else if (hasTraitFilters) {
    listingIds = Object.keys(traitsData).filter(
      (id) =>
        listingNFTs.has(String(id)) &&
        matchesSelectedTraits(id, selectedTraits),
    );
  } else {
    listingIds = Object.keys(traitsData).filter((id) =>
      listingNFTs.has(String(id)),
    );
  }

  if (hasAffinityFilters) {
    listingIds = listingIds.filter((id) => {
      const a = affinityData[id];
      return (
        a &&
        (selectedBodyAffinities.size === 0 ||
          selectedBodyAffinities.has(a.body)) &&
        (selectedHandAffinities.size === 0 ||
          selectedHandAffinities.has(a.hand))
      );
    });
  }
  if (hasActiveStatFilters())
    listingIds = listingIds.filter((id) => passesStatMinMaxFilters(id));

  filteredNFTIds = currentListingSortOrder
    ? getSortedListingIds(listingIds)
    : getSortedNFTIds(listingIds);
  isFiltering = true;

  const filterSummaryHTML = hasTraitFilters
    ? `<div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">${buildTraitSummaryButtonsHTML(selectedTraits)}</div>`
    : "";

  appendCountHeader(
    resultsDiv,
    `Found ${listingIds.length} listing Kamigotchi${getAffinityNotation()}`,
    filterSummaryHTML,
  );

  if (filteredNFTIds.length === 0) {
    const noResultsDiv = document.createElement("div");
    noResultsDiv.className = "no-results";
    noResultsDiv.textContent =
      "No listing Kamigotchi found with current filters";
    resultsDiv.appendChild(noResultsDiv);
    return;
  }

  currentLoadIndex = 0;
  loadMoreNFTs();
  setupInfiniteScroll();
}

function filterByTraits() {
  const resultsDiv = document.getElementById("results");
  resultsDiv.textContent = "";

  const selectedTraits = getSelectedTraitsFromCheckboxes();
  const hasTraitFilters = Object.keys(selectedTraits).length > 0;
  const hasAffinityFilters =
    selectedBodyAffinities.size > 0 || selectedHandAffinities.size > 0;
  const hasStatFilters = hasActiveStatFilters();

  if (!hasTraitFilters && !hasAffinityFilters && !hasStatFilters) {
    isFiltering = false;
    if (
      isShowingClonesOnly &&
      !(isShowingListingOnly && currentListingSortOrder)
    )
      filterClones();
    else if (isShowingListingOnly) filterListing();
    else {
      allNFTIds = getSortedNFTIds(Object.keys(traitsData));
      loadInitialNFTs();
    }
    return;
  }

  const filteringMessage = document.createElement("div");
  filteringMessage.className = "no-results";
  filteringMessage.textContent = "Filtering...";
  resultsDiv.appendChild(filteringMessage);

  const baseIDs = isShowingClonesOnly
    ? Array.from(traitSignatures.cloneIds)
    : Object.keys(traitsData);

  let matchingNFTs = hasTraitFilters
    ? baseIDs.filter((id) => matchesSelectedTraits(id, selectedTraits))
    : baseIDs;

  if (hasAffinityFilters) {
    matchingNFTs = matchingNFTs.filter((id) => {
      const a = affinityData[id];
      return (
        a &&
        (selectedBodyAffinities.size === 0 ||
          selectedBodyAffinities.has(a.body)) &&
        (selectedHandAffinities.size === 0 ||
          selectedHandAffinities.has(a.hand))
      );
    });
  }
  if (hasStatFilters)
    matchingNFTs = matchingNFTs.filter((id) => passesStatMinMaxFilters(id));
  if (isShowingListingOnly)
    matchingNFTs = matchingNFTs.filter((id) => listingNFTs.has(String(id)));

  filteredNFTIds =
    isShowingListingOnly && currentListingSortOrder
      ? getSortedListingIds(matchingNFTs)
      : getSortedNFTIds(matchingNFTs);
  isFiltering = true;

  if (
    isShowingClonesOnly &&
    !(isShowingListingOnly && currentListingSortOrder)
  ) {
    filterClones();
    return;
  }
  if (isShowingListingOnly) {
    filterListing();
    return;
  }

  resultsDiv.textContent = "";

  const filterSummaryHTML = `
        <div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">
            ${buildTraitSummaryButtonsHTML(selectedTraits)}
        </div>
    `;

  appendCountHeader(
    resultsDiv,
    `Found matching Kamigotchi: ${filteredNFTIds.length}${getAffinityNotation()}`,
    filterSummaryHTML,
  );

  if (filteredNFTIds.length === 0) {
    const noResultsDiv = document.createElement("div");
    noResultsDiv.className = "no-results";
    noResultsDiv.textContent = "No Kamigotchi match your selected traits";
    resultsDiv.appendChild(noResultsDiv);
    return;
  }

  currentLoadIndex = 0;
  loadMoreNFTs();
  setupInfiniteScroll();
}

function removeSelectedTrait(event) {
  const { traitType, traitValue } = event.currentTarget.dataset;
  const checkbox = document.querySelector(
    `.trait-checkbox[data-trait-type="${traitType}"][data-trait-value="${traitValue}"]`,
  );
  if (checkbox) {
    checkbox.checked = false;
    updateSelectedTraitsDisplay(true);
  }
}

function updateSelectedTraitsDisplay(forceUpdate = false) {
  const selectedTraitsDiv = document.getElementById("selectedTraitsDisplay");
  if (selectedTraitsDiv) selectedTraitsDiv.style.display = "none";

  validateAffinitiesAgainstCheckboxes();

  const checkboxes = document.querySelectorAll(".trait-checkbox:checked");

  if (checkboxes.length === 0 && (isFiltering || forceUpdate)) {
    isFiltering = false;
    filteredNFTIds = [];
    selectedBodyAffinities.clear();
    selectedHandAffinities.clear();
    updateAffinityButtonStates();

    if (
      isShowingClonesOnly &&
      !(isShowingListingOnly && currentListingSortOrder)
    )
      preserveScroll(() => {
        filterClones();
        updateURL();
      });
    else if (isShowingListingOnly)
      preserveScroll(() => {
        filterListing();
        updateURL();
      });
    else if (hasActiveStatFilters())
      preserveScroll(() => {
        filterByTraits();
        updateURL();
      });
    else
      preserveScroll(() => {
        allNFTIds = getSortedNFTIds(Object.keys(traitsData));
        loadInitialNFTs();
        updateURL();
      });
    return;
  }

  updateURL();
  if (isShowingListingOnly) preserveScroll(() => filterListing());
  else if (isShowingClonesOnly) preserveScroll(() => filterClones());
  else preserveScroll(() => filterByTraits());
}

function clearFilters() {
  document
    .querySelectorAll(".trait-checkbox")
    .forEach((cb) => (cb.checked = false));
  document.querySelectorAll(".trait-search").forEach((input) => {
    input.value = "";
    filterTraitOptions(input.dataset.traitType, "");
  });

  const dropdown = document.getElementById("traitCategoryDropdown");
  if (dropdown) dropdown.value = "";
  document
    .querySelectorAll(".filter-group")
    .forEach((group) => (group.style.display = "none"));

  selectedBodyAffinities.clear();
  selectedHandAffinities.clear();
  updateAffinityButtonStates();

  document.querySelectorAll(".stat-control").forEach((control) => {
    const slider = control.querySelector('input[type="range"]');
    const valueDisplay = control.querySelector(".stat-control-input-value");
    const toggleInput = control.querySelector(".toggle-input");
    if (slider) {
      slider.value = slider.min;
      if (valueDisplay) valueDisplay.textContent = slider.min;
    }
    if (toggleInput) toggleInput.checked = false;
  });
  Object.keys(statMinMaxFilters).forEach((statName) => {
    const slider = document.querySelector(
      `.stat-control.${statName} .stat-control-input`,
    );
    statMinMaxFilters[statName].value = slider ? Number(slider.min) : 0;
    statMinMaxFilters[statName].isMax = false;
  });

  isFiltering = false;
  filteredNFTIds = [];

  if (isShowingClonesOnly)
    preserveScroll(() => {
      filterClones();
      updateURL();
    });
  else if (isShowingListingOnly)
    preserveScroll(() => {
      filterListing();
      updateURL();
    });
  else
    preserveScroll(() => {
      allNFTIds = getSortedNFTIds(Object.keys(traitsData));
      loadInitialNFTs();
      updateURL();
    });
}

// ============================================================
// NFT CARD RENDERING
// ============================================================

function timeAgo(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return null;
  const m = Math.floor(diff / 60000);
  if (m < 60) return m <= 1 ? "just now" : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function getStatColorClass() {
  const statSorts = ["harmony", "health", "power", "violence"];
  return statSorts.includes(currentSortOrder) ? currentSortOrder : "";
}

// Global overlay page state: 0 = traits, 1 = stats, 2 = info.
let kamiOverlayPage = 0;

function applyKamiPage(page) {
  kamiOverlayPage = page;
  const cards = Array.from(document.querySelectorAll(".nft-card"));
  const BATCH = 20;
  let i = 0;
  function nextBatch() {
    const end = Math.min(i + BATCH, cards.length);
    for (; i < end; i++) {
      const slot = cards[i].querySelector(".kami-overlay-slot");
      if (slot)
        slot.innerHTML = getOverlaySlotHTML(cards[i].dataset.nftId, page);
    }
    if (i < cards.length) requestAnimationFrame(nextBatch);
  }
  requestAnimationFrame(nextBatch);
}
function getOverlaySlotHTML(id, page) {
  if (page === 1) {
    const stats = kamiStatsData[id];
    if (!stats) return "";
    return `
        <div class="kami-stats">
            <div class="stat-row one">
                <div class="stat-item health"><div class="stat-value">${stats.stats.health}</div></div>
                <div class="stat-item power"><div class="stat-value">${stats.stats.power}</div></div>
            </div>
            <div class="stat-row">
                <div class="stat-item violence"><div class="stat-value">${stats.stats.violence}</div></div>
                <div class="stat-item harmony"><div class="stat-value">${stats.stats.harmony}</div></div>
            </div>
        </div>`;
  }
  if (page === 2) {
    const _kamiInfo = kamiInfoData[id] || {};
    const _kamiAccount = kamiToAccount[id] || [];
    const _kamiName = _kamiInfo.name || `Kamigotchi ${id}`;
    const isWildKami = wildNFTs.has(String(id));

    const _wildOwner = isWildKami ? wildKamiOwners[String(id)] || {} : null;
    const _ownerName = isWildKami
      ? _wildOwner.accountName || "—"
      : _kamiAccount[0] || "—";
    const _accountIdx = isWildKami
      ? _wildOwner.accountIndex != null
        ? `#${_wildOwner.accountIndex}`
        : "—"
      : _kamiAccount[1] != null
        ? `#${_kamiAccount[1]}`
        : "—";
    const _level = _kamiInfo.level != null ? _kamiInfo.level : "—";
    const _s = _kamiInfo.stats || [];
    const isSacrificed = sacrificedNFTs.has(String(id));
    const sacrificeUnix = isSacrificed ? sacrificedNFTs.get(String(id)) : null;
    const ripDateHTML =
      isSacrificed && sacrificeUnix
        ? `<div class="last sacrifice-time">r.i.p: ${new Date(sacrificeUnix * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>`
        : "";
    return `
        <div class="kami-info">
            <div>${_kamiName}</div><div>Owner: ${_ownerName}</div><div>(Id: ${_accountIdx})</div><div>Level: ${_level}</div><div${isSacrificed ? "" : ' class="last"'}>stats: ${_s[0]}/${_s[1]}/${_s[2]}/${_s[3]}</div>${ripDateHTML}
        </div>`;
  }
  // page === 0: traits
  const traits = traitsData[id];
  if (!traits) return "";
  const traitsHTML = Object.entries(traits)
    .map(
      ([key, traitData]) => `
            <div class="trait">
                <p>${key.charAt(0).toUpperCase() + key.slice(1)}: ${getTraitName(traitData)}</p>
            </div>`,
    )
    .join("");
  return `<div class="kami-traits">${traitsHTML}</div>`;
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
  const rank = rarityData ? rarityData.rank : "?";
  const score = rarityData ? rarityData.score.toFixed(4) : "?";
  const isTied = rarityData ? rarityData.isTied : false;

  const isNew =
    metadataInfo.kamiNewWindow &&
    Object.prototype.hasOwnProperty.call(
      metadataInfo.kamiNewWindow,
      String(id),
    );
  const isClone = traitSignatures.cloneIds.has(id);
  const isSacrificed = sacrificedNFTs.has(String(id));
  const isWild = wildNFTs.has(String(id));
  const listingData = listingNFTs.get(String(id));
  const listingPrice = listingData?.price;
  const isListing = listingData !== undefined;
  const isNewListing =
    isListing &&
    listingMetaInfo.listingNewWindow &&
    String(id) in listingMetaInfo.listingNewWindow;

  const card = document.createElement("div");
  card.className = "nft-card hover_wrapper";
  card.dataset.nftId = id;

  const totalNFTs = totalNFTsCount;
  const rankPercentile = (rank / totalNFTs) * 100;
  let rankClass = "rank-common";
  if (rankPercentile <= 1) rankClass = "rank-legendary";
  else if (rankPercentile <= 5) rankClass = "rank-epic";
  else if (rankPercentile <= 15) rankClass = "rank-rare";
  else if (rankPercentile <= 40) rankClass = "rank-uncommon";

  const statColorClass = getStatColorClass();
  const statValue = stats?.stats[currentSortOrder] || "";
  const rankTooltip = isTied
    ? `Rank: #${rank} (Tied) | Score: ${score}`
    : `Rank: #${rank} | Score: ${score}`;

  const closeButtonHTML = showCloseButton
    ? `<button class="close-btn" onclick="removeSelectedID('${id}')" title="Remove this Kamigotchi">×</button>`
    : "";
  const newBadgeHTML = isNew
    ? `<div class="new-badge" title="Recently Added!">NEW</div>`
    : "";
  const cloneBadgeHTML = isClone
    ? `<div class="clone-badge" title="This Kamigotchi has identical traits to others">CLONE</div>`
    : "";
  const sacrificeBadgeHTML = isSacrificed
    ? `<div class="sacrifice-badge" title="This Kamigotchi has been sacrificed">🕳️</div>`
    : "";
  const wildBadgeHTML = isWild
    ? `<div class="wild-badge" title="This Kamigotchi is in wild"><img id="wild_icon" src="https://app.kamigotchi.io/assets/link_to_external_apps-BtyJUHk_.png" style="border:none"></div>`
    : "";
  const listingBadgeHTML = isListing
    ? `<div class="listing-badge"><img id="kamiswap_icon" src="https://app.kamigotchi.io/assets/marketplace-BqMKbOFC.png" style="border:none"></div>`
    : "";
  const listingPriceHTML = isListing
    ? `<div class="listing-price">Ξ${listingPrice}</div>`
    : "";
  const newListingIconHTML = isNewListing
    ? `<div class="new-listing-icon">New</div>`
    : "";
  const listingTimeHTML =
    isShowingListingOnly && listingData?.listedTime
      ? `<div class="stat-color-box listing-time-ago">📍</div>`
      : "";
  const statColorHTML = listingTimeHTML
    ? listingTimeHTML
    : statColorClass
      ? `<div class="stat-color-box ${statColorClass}" title="${statColorClass.charAt(0).toUpperCase() + statColorClass.slice(1)} Sort">${statValue}</div>`
      : "";

  const kamiOverlayControlsHTML = `
        <div class="kami-overlay-controls">
            <button class="kami-overlay-arrow" title="Switch page"></button>
        </div>`;

  const kamiOverlaySlotHTML = `<div class="kami-overlay-slot">${getOverlaySlotHTML(id, kamiOverlayPage)}</div>`;

  const rankBadge = `
        <div class="rank-stat-container">
            <div class="rank-badge ${rankClass}" title="${rankTooltip}">${rank}</div>
            ${statColorHTML}
            ${newBadgeHTML}
            ${cloneBadgeHTML}
        </div>`;

  const listingTimeTextHTML =
    isShowingListingOnly && listingData?.listedTime
      ? `<div class="listing-time">${timeAgo(listingData.listedTime)} · ${new Date(listingData.listedTime).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>`
      : "";

  const imageBlock = `
        <div class="image-container">
            <img src="${imageUrl}" alt="NFT #${id}" loading="lazy" onerror="this.src='https://via.placeholder.com/250?text=Not+Found'">
            ${sacrificeBadgeHTML}
            ${listingBadgeHTML}
            ${listingPriceHTML}
            ${newListingIconHTML}
            ${listingTimeTextHTML}
            ${wildBadgeHTML}
        </div>`;

  if (isMobile) {
    card.innerHTML = `
            ${closeButtonHTML}
            ${rankBadge}
            ${kamiOverlaySlotHTML}
            ${kamiOverlayControlsHTML}
            <div class="nft-card-content">
                ${imageBlock}
                <div class="nft-id">Kamigotchi ${id}</div>
            </div>`;
  } else {
    card.innerHTML = `
            ${closeButtonHTML}
            ${rankBadge}
            ${kamiOverlaySlotHTML}
            ${kamiOverlayControlsHTML}
            <div class="nft-card-content">
                ${imageBlock}
                <div class="nft-id">Kamigotchi ${id}</div>
            </div>`;
  }

  card.querySelector(".kami-overlay-arrow").addEventListener("click", (e) => {
    e.stopPropagation();
    // Cycle all cards together: traits(0) → stats(1) → info(2) → history(3) → traits ...
    applyKamiPage((kamiOverlayPage + 1) % 4);
  });

  // Rank badge click: toggle ALL badges globally between openrarity and in-game rank
  const rankBadgeEl = card.querySelector(".rank-badge");
  if (rankBadgeEl) {
    if (isShowingIngameRank) {
      const ingameRank = kamiInGameRanks[id];
      const scores = kamiScoresData[id] || [];
      rankBadgeEl.textContent = ingameRank ?? rank;
      rankBadgeEl.title = `In-game Rank: #${ingameRank ?? "?"} | Overall: ${scores[1] ?? "?"} | Rarity: ${scores[0] ?? "?"}`;
      rankBadgeEl.setAttribute("style", "color: #667eea");
    }
    rankBadgeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.umami) umami.track("switch-rank");
      isShowingIngameRank = !isShowingIngameRank;
      document.querySelectorAll(".nft-card").forEach((c) => {
        const badge = c.querySelector(".rank-badge");
        if (!badge) return;
        const cId = c.dataset.nftId;
        if (isShowingIngameRank) {
          const ingameRank = kamiInGameRanks[cId];
          const scores = kamiScoresData[cId] || [];
          badge.textContent = ingameRank ?? nftRarityScores[cId]?.rank ?? "?";
          badge.title = `In-game Rank: #${ingameRank ?? "?"} | Overall: ${scores[1] ?? "?"} | Rarity: ${scores[0] ?? "?"}`;
          badge.setAttribute("style", "color: #667eea");
        } else {
          const rd = nftRarityScores[cId];
          const r = rd ? rd.rank : "?";
          const s = rd ? rd.score.toFixed(4) : "?";
          badge.textContent = r;
          badge.title = rd?.isTied
            ? `Rank: #${r} (Tied) | Score: ${s}`
            : `Rank: #${r} | Score: ${s}`;
          badge.setAttribute("style", "background: rgba(255, 240, 31, 0.3);");
        }
      });
    });
  }

  // slot already renders the correct page; just mark card active
  card.classList.add("is-active");

  return card;
}

// ============================================================
// INFINITE SCROLL & CARD LOADING
// ============================================================

function loadInitialNFTs() {
  const resultsDiv = document.getElementById("results");
  resultsDiv.textContent = "";

  const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;

  let title = "Showing all Kamigotchi";
  if (isShowingClonesOnly) {
    const uniqueSignatures = new Set(
      idsToDisplay.map((id) => traitSignatures.signatures[id]),
    );
    title = `Showing ${idsToDisplay.length} clones in ${uniqueSignatures.size} groups`;
  } else if (isFiltering) {
    title = "Found matching Kamigotchi";
  }

  resultsDiv.appendChild(createCountHeader(idsToDisplay.length, title));
  currentLoadIndex = 0;
  loadMoreNFTs();
  setupInfiniteScroll();
}

function loadMoreNFTs() {
  if (isLoading) return;
  isLoading = true;

  const resultsDiv = document.getElementById("results");
  const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
  const endIndex = Math.min(
    currentLoadIndex + LAZY_LOAD_COUNT,
    idsToDisplay.length,
  );

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
      const cards = resultsDiv.querySelectorAll(".nft-card");
      if (cards.length > 0) nftObserver.observe(cards[cards.length - 1]);
    }
  });
}

function createLoadingIndicator() {
  const indicator = document.createElement("div");
  indicator.id = "loadingIndicator";
  indicator.className = "loading-indicator";
  indicator.innerHTML = "Loading more Kamigotchi...";
  indicator.style.display = "none";
  return indicator;
}

function updateLoadingIndicator() {
  let indicator = document.getElementById("loadingIndicator");
  if (!indicator) {
    indicator = createLoadingIndicator();
    document.getElementById("results").appendChild(indicator);
  }
  const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
  if (currentLoadIndex >= idsToDisplay.length) indicator.style.display = "none";
}

function setupInfiniteScroll() {
  if (nftObserver) nftObserver.disconnect();

  nftObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
        if (
          entry.isIntersecting &&
          currentLoadIndex < idsToDisplay.length &&
          !isLoading
        ) {
          loadMoreNFTs();
        }
      });
    },
    { rootMargin: "200px" },
  );

  const cards = document.querySelectorAll(".nft-card");
  if (cards.length > 0) nftObserver.observe(cards[cards.length - 1]);
}

function createCountHeader(count, title) {
  const countDiv = document.createElement("div");
  countDiv.className = "count-header";
  countDiv.innerHTML = `
        <div style="font-size: 14px;">${title}: ${count}</div>
        <div class="note">** click the lil arrow on card for og stats and more info **</div>
    `;
  return countDiv;
}

// ============================================================
// SELECTED IDs (COMPARISON AREA).
// ============================================================

function updateSelectedIDsDisplay() {
  const selectedIDsDiv = document.getElementById("selectedIDs");

  if (selectedIDs.size === 0) {
    selectedIDsDiv.style.display = "none";
    return;
  }

  selectedIDsDiv.style.display = "block";
  selectedIDsDiv.innerHTML = "";
  const cardsContainer = document.createElement("div");
  cardsContainer.className = "selected-cards-grid";

  let idsArray = Array.from(selectedIDs);

  if (isShowingListingOnly && currentListingSortOrder) {
    idsArray = getSortedListingIds(idsArray);
  } else {
    idsArray = getSortedNFTIds(idsArray);
  }

  idsArray.forEach((id) => {
    const card = displayNFT(id, true);
    if (card) cardsContainer.appendChild(card);
  });

  selectedIDsDiv.appendChild(cardsContainer);
  updateURL();
}

function searchByID() {
  const searchInput = document.getElementById("searchInput");
  const id = searchInput.value.trim();

  const showMessage = (text) => {
    const messageBox = document.getElementById("messageBox");
    messageBox.textContent = text;
    messageBox.style.display = "block";
    setTimeout(() => (messageBox.style.display = "none"), 3000);
  };

  if (!id) {
    showMessage("Please enter an NFT ID");
    return;
  }
  if (!imagesData[id] || !traitsData[id]) {
    showMessage(
      `Kamigotchi #${id} not found. Please check the ID and try again.`,
    );
    return;
  }
  if (selectedIDs.has(id)) {
    showMessage(`Kamigotchi #${id} is already added!`);
    return;
  }

  selectedIDs.add(id);
  updateSelectedIDsDisplay();
  searchInput.value = "";
  updateURL();
}

function removeSelectedID(id) {
  selectedIDs.delete(id);
  updateSelectedIDsDisplay();
  updateURL();
}
window.removeSelectedID = removeSelectedID;

// Exposed for trade-history.js: lets external scripts set the filtered list and trigger a render
window.setFilteredNFTIds = function (ids) {
  filteredNFTIds = ids;
  isFiltering = true;
  currentLoadIndex = 0;
};
window.filterListing = filterListing;
window.loadInitialNFTs = loadInitialNFTs;
window.loadMoreNFTs = loadMoreNFTs;
window.setupInfiniteScroll = setupInfiniteScroll;
window.updateURL = updateURL;
window.handlePopState = handlePopState;
window.setIsShowingListingOnly = function (val) {
  isShowingListingOnly = val;
};
window.refreshData = refreshData;
Object.defineProperty(window, "traitsData", { get: () => traitsData });

// Patch updateURL: when trade history is active, always keep tradehistory=true in the URL
// so co-filters (clones, traits, affinity, minmax) don't silently drop it.
const _origUpdateURL = updateURL;
updateURL = function (replace) {
  _origUpdateURL(replace);
  if (window.__tradeHistoryActive) {
    const params = new URLSearchParams(window.location.search);
    params.set("tradehistory", "true");
    const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    history.replaceState(history.state, "", newUrl);
  }
};

// Resets only sort-order and listing-sort state without triggering a re-render.
// Called by trade-history.js before it takes over the results area.
// Traits, affinity, min-max, and clone filters are intentionally left intact
// so filterTradeHistory can apply them on top of the history ID list.
window.resetAllFilters = function () {
  // Deactivate listing-sort and regular sort buttons only
  isShowingListingOnly = false;
  currentListingSortOrder = null;
  document
    .querySelectorAll(".listing-sort-btn")
    .forEach((b) => b.classList.remove("active"));
  // listingFilterBtn stays visually active — trade history lives inside the listing section
  document.getElementById("listingFilterBtn")?.classList.add("active");
  const listingSortSection = document.querySelector(".listing-sort-section");
  if (listingSortSection) listingSortSection.style.display = "block";

  // Remove active from all sort buttons (trade history owns the view)
  currentSortOrder = "latest";
  document
    .querySelectorAll(".sort-btn")
    .forEach((b) => b.classList.remove("active"));
};

// Filter helpers exposed for trade-history.js
window.getSelectedTraitsFromCheckboxes = getSelectedTraitsFromCheckboxes;
window.matchesSelectedTraits = matchesSelectedTraits;
window.hasActiveStatFilters = hasActiveStatFilters;
window.passesStatMinMaxFilters = passesStatMinMaxFilters;
window.appendCountHeader = appendCountHeader;
window.buildTraitSummaryButtonsHTML = buildTraitSummaryButtonsHTML;
window.getAffinityNotation = getAffinityNotation;
Object.defineProperty(window, "selectedBodyAffinities", {
  get: () => selectedBodyAffinities,
});
Object.defineProperty(window, "selectedHandAffinities", {
  get: () => selectedHandAffinities,
});
Object.defineProperty(window, "affinityData", { get: () => affinityData });
Object.defineProperty(window, "traitSignatures", {
  get: () => traitSignatures,
});
Object.defineProperty(window, "isShowingClonesOnly", {
  get: () => isShowingClonesOnly,
});

// Patched updateSelectedTraitsDisplay: when trade history owns the view, re-run
// filterTradeHistory instead of script.js's own re-render (which doesn't know about history).
const _origUpdateSelectedTraitsDisplay = updateSelectedTraitsDisplay;
updateSelectedTraitsDisplay = function (forceUpdate) {
  if (window.__tradeHistoryActive) {
    validateAffinitiesAgainstCheckboxes();
    updateAffinityButtonStates();
    setTimeout(() => {
      if (
        window.__tradeHistoryActive &&
        typeof window._filterTradeHistory === "function"
      ) {
        window._filterTradeHistory();
      }
    }, 0);
    return;
  }
  _origUpdateSelectedTraitsDisplay(forceUpdate);
};

function clearAllSelectedIDs() {
  selectedIDs.clear();
  updateSelectedIDsDisplay();
  document.getElementById("searchInput").value = "";
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
      sacrificedNFTs = new Map(
        data.map((item) => [String(item.kami_index), item.revealed_at_unix]),
      );
      console.log(`🕳️ Loaded ${sacrificedNFTs.size} sacrifice records`);
    }
  } catch (err) {}
}

async function loadListingsData(v) {
  try {
    const isLocal =
      window.location.hostname === "localhost" ||
      window.location.hostname.startsWith("192.168.");
    const finalUrl = isLocal
      ? `https://data.kami.h80h.xyz/kamiListings.json?v=${v}`
      : `/api/data/kamiListings.json?v=${v}`;
    const response = await fetch(finalUrl);
    if (response.ok) {
      const data = await response.json();
      const rawListings =
        data && typeof data === "object" && "listings" in data
          ? data.listings
          : data;
      listingNFTs = new Map(
        Object.values(rawListings).map((item) => {
          if (item !== null && typeof item === "object") {
            return [
              String(item.id),
              { price: item.price, listedTime: item.listedTime ?? null },
            ];
          } else {
            return [String(item), { price: item, listedTime: null }];
          }
        }),
      );
      listingMetaInfo = {
        newListingId: (data?.newListingId ?? []).map(String),
        listingNewWindow: data?.listingNewWindow ?? {},
      };
      console.log(
        `🛍️ Loaded ${listingNFTs.size} listing Kamigotchi on KamiSwap`,
      );
      if (listingMetaInfo.newListingId.length > 0) {
        console.log(
          `✨ Found ${listingMetaInfo.newListingId.length} new listing(s): ${listingMetaInfo.newListingId.join(", ")}`,
        );
      }
    }
  } catch (err) {}
}

async function loadKamiInfoData(v) {
  try {
    // kamiOwnerMap is pre-inverted by the extractor: { kamiIndex: [accountName, accountIndex] }
    // Just assign directly — no loop needed
    kamiToAccount = _bundleKamiOwnerMap;
    _bundleKamiOwnerMap = null; // free staging slot
    console.log(
      `📖 Loaded info for ${Object.keys(kamiInfoData).length} Kamigotchi`,
    );
  } catch (err) {}
}

function getSignificantListingsHash(listingsData) {
  // Avoid Object.fromEntries(listingNFTs) which materializes the whole Map into a
  // temporary plain object on every poll tick — stringify the entries array directly.
  return JSON.stringify({
    listings: [...listingNFTs.entries()],
    listingNewWindow: listingsData?.listingNewWindow ?? {},
  });
}

function getSignificantMetaHash(meta) {
  return JSON.stringify({
    kamiNewWindow: meta.kamiNewWindow,
    totalCount: meta.totalCount,
  });
}

function patchNewBadges(newWindow) {
  metadataInfo.kamiNewWindow = newWindow;
  document.querySelectorAll(".nft-card").forEach((card) => {
    const id = card.dataset.nftId;
    const rankStatContainer = card.querySelector(".rank-stat-container");
    if (!rankStatContainer) return;
    const shouldHave = Object.prototype.hasOwnProperty.call(
      newWindow,
      String(id),
    );
    const existing = rankStatContainer.querySelector(".new-badge");
    if (shouldHave && !existing) {
      const badge = document.createElement("div");
      badge.className = "new-badge";
      badge.title = "Recently Added!";
      badge.textContent = "NEW";
      rankStatContainer.appendChild(badge);
    } else if (!shouldHave && existing) {
      existing.remove();
    }
  });
}

function patchNewListingIcons(newListingWindow) {
  listingMetaInfo.listingNewWindow = newListingWindow;
  document.querySelectorAll(".nft-card").forEach((card) => {
    const id = card.dataset.nftId;
    const imageContainer = card.querySelector(".image-container");
    if (!imageContainer) return;

    // Patch new-listing-icon
    const shouldHaveNewIcon = String(id) in newListingWindow;
    const existingNewIcon = imageContainer.querySelector(".new-listing-icon");
    if (shouldHaveNewIcon && !existingNewIcon) {
      const icon = document.createElement("div");
      icon.className = "new-listing-icon";
      icon.textContent = "New";
      imageContainer.appendChild(icon);
    } else if (!shouldHaveNewIcon && existingNewIcon) {
      existingNewIcon.remove();
    }

    // Patch listing-badge and listing-price
    const listingData = listingNFTs.get(String(id));
    const shouldHaveListing = listingData !== undefined;
    const existingBadge = imageContainer.querySelector(".listing-badge");
    const existingPrice = imageContainer.querySelector(".listing-price");
    if (shouldHaveListing && !existingBadge) {
      const badge = document.createElement("div");
      badge.className = "listing-badge";
      badge.innerHTML = `<img id="kamiswap_icon" src="https://app.kamigotchi.io/assets/marketplace-BqMKbOFC.png" style="border:none">`;
      imageContainer.appendChild(badge);
    } else if (!shouldHaveListing && existingBadge) {
      existingBadge.remove();
    }
    if (shouldHaveListing && !existingPrice) {
      const price = document.createElement("div");
      price.className = "listing-price";
      price.textContent = `Ξ${listingData.price}`;
      imageContainer.appendChild(price);
    } else if (!shouldHaveListing && existingPrice) {
      existingPrice.remove();
    } else if (shouldHaveListing && existingPrice) {
      existingPrice.textContent = `Ξ${listingData.price}`;
    }
  });
}

function patchInfoOverlays(freshOwnerMap) {
  // freshOwnerMap: { [kamiIndex]: [accountName, accountIndex] } — same shape as kamiToAccount
  kamiToAccount = freshOwnerMap;
  if (kamiOverlayPage !== 2) return; // nobody is on the info page, skip DOM work
  document.querySelectorAll(".nft-card").forEach((card) => {
    const slot = card.querySelector(".kami-overlay-slot");
    if (slot) slot.innerHTML = getOverlaySlotHTML(card.dataset.nftId, 2);
  });
}

async function checkForUpdates() {
  try {
    const v = Math.floor(Date.now() / (5 * 60 * 1000));
    const isLocal =
      window.location.hostname === "localhost" ||
      window.location.hostname.startsWith("192.168.");
    const baseUrl = isLocal ? "https://data.kami.h80h.xyz" : "/api/data";

    const [listingsRes, metaRes] = await Promise.all([
      fetch(`${baseUrl}/kamiListings.json?v=${v}`),
      fetch(`${baseUrl}/kamiMeta.json?v=${v}`),
    ]);

    let shouldRefresh = false;

    // ── listings ─────────────────────────────────────────────────────
    let newListings = null;
    if (listingsRes.ok) {
      newListings = await listingsRes.json();
      const newHash = getSignificantListingsHash(newListings);
      if (cachedListingsHash && newHash !== cachedListingsHash) {
        console.log("🛍️ Listings changed, refreshing all data...");
        shouldRefresh = true;
      }
      cachedListingsHash = newHash;

      const newListingMetaHash = JSON.stringify(
        newListings?.listingNewWindow ?? {},
      );
      if (
        cachedListingsMetaHash &&
        newListingMetaHash !== cachedListingsMetaHash &&
        !shouldRefresh
      ) {
        patchNewListingIcons(newListings?.listingNewWindow ?? {});
      }
      cachedListingsMetaHash = newListingMetaHash;
    }

    // ── kami meta ─────────────────────────────────────────────────────
    if (metaRes.ok) {
      const newMeta = await metaRes.json();

      const countChanged = newMeta.totalCount !== metadataInfo.totalCount;
      const windowChanged =
        JSON.stringify(newMeta.kamiNewWindow) !==
        JSON.stringify(metadataInfo.kamiNewWindow);
      const newAccountsHash = JSON.stringify(newMeta.accountIdMap ?? {});
      const accountsChanged =
        cachedAccountsHash && newAccountsHash !== cachedAccountsHash;

      if (countChanged) {
        console.log("🆕 New Kamigotchi detected, refreshing all data...");
        shouldRefresh = true;
      } else if (windowChanged && !shouldRefresh) {
        patchNewBadges(newMeta.kamiNewWindow);
      }

      // Ownership changes require a full bundle refresh — kamiMeta.json no longer
      // carries kamiOwnerMap, so we can't patch in place without re-fetching the bundle.
      if (accountsChanged && !shouldRefresh) {
        console.log("👤 Ownership changed, refreshing all data...");
        shouldRefresh = true;
      }

      cachedMetaHash = getSignificantMetaHash(newMeta);
      cachedAccountsHash = newAccountsHash;
      if (!shouldRefresh) metadataInfo.totalCount = newMeta.totalCount;
    }

    if (shouldRefresh) {
      await refreshData();
    }
  } catch (err) {}
}

function startAutoRefresh() {
  setInterval(checkForUpdates, 5 * 60 * 1000);
}

async function fetchAndSplitBundle(v) {
  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname.startsWith("192.168.");
  const finalUrl = isLocal
    ? `https://data.kami.h80h.xyz/kamiBundle.json?v=${v}`
    : `/api/data/kamiBundle.json?v=${v}`;

  const response = await fetch(finalUrl);
  if (!response.ok)
    throw new Error(`Failed to load kamiBundle.json: ${response.status}`);

  let bundle = await response.json();
  if (!bundle.kamiImage || !bundle.kamiTraits) {
    bundle = null;
    throw new Error(
      "Bundle is missing required sections (kamiImage / kamiTraits)",
    );
  }

  imagesData = bundle.kamiImage;
  bundle.kamiImage = null;
  traitsData = bundle.kamiTraits;
  bundle.kamiTraits = null;
  kamiTraitIndexData = bundle.kamiTraitIndex || {};
  bundle.kamiTraitIndex = null;
  metadataInfo = bundle.kamiMetadata || { newKamiIds: [] };
  bundle.kamiMetadata = null;
  kamiInfoData = bundle.kamiInfo || {};
  bundle.kamiInfo = null;
  _bundleKamiOwnerMap = bundle.kamiOwnerMap || {};
  bundle.kamiOwnerMap = null;
  bundle.accountIdMap = null; // only consumed by trade-history.js via kamiMeta.json
  kamiScoresData = bundle.kamiScores || {};
  bundle.kamiScores = null;
  if (bundle.wildKamiOwners) {
    wildKamiOwners = bundle.wildKamiOwners;
    wildNFTs = new Set(Object.keys(wildKamiOwners));
    console.log(`🔍 Found ${wildNFTs.size} wild Kamigotchi`);
  } else {
    wildKamiOwners = {};
    wildNFTs = new Set();
  }
  bundle.wildKamiOwners = null;

  bundle = null;
}

const BASE_STATS = {
  harmony: 10,
  health: 50,
  power: 10,
  violence: 10,
  slots: 0,
};

// Traits that share a name across categories — resolved by entity id per category.
// All other traits are looked up by name alone (no ambiguity).
const AMBIGUOUS_TRAIT_ENTITIES = {
  "background:Blue": 151,
  "background:Orange": 165,
  "background:Pink": 166,
  "background:Purple": 167,
  "background:Yellow": 171,
  "background:Butterfly": 172,
  "body:Butterfly": 181,
  "body:Drip": 185,
  "body:Plant": 199,
  "color:Blue": 213,
  "color:Orange": 217,
  "color:Pink": 218,
  "color:Purple": 219,
  "color:Yellow": 222,
  "face:Drip": 247,
  "hand:Plant": 276,
};

function buildTraitNameToIndex() {
  // Primary lookup: name → entry (for unambiguous traits)
  // Ambiguous traits are overwritten here but resolved via lookupTrait()
  const lookup = {};
  Object.values(kamiTraitIndexData).forEach((entry) => {
    lookup[entry.name] = entry;
  });
  return lookup;
}

// Entity id → entry map, built once alongside traitNameToIndex
let traitEntityToIndex = {};
function buildTraitEntityToIndex() {
  const lookup = {};
  Object.values(kamiTraitIndexData).forEach((entry) => {
    lookup[entry.entity] = entry;
  });
  return lookup;
}

// Resolve a trait entry given its category slot and name.
// Ambiguous names are routed to the correct entity; all others fall back to name lookup.
function lookupTrait(category, name) {
  const entityId = AMBIGUOUS_TRAIT_ENTITIES[`${category}:${name}`];
  if (entityId !== undefined) return traitEntityToIndex[entityId];
  return traitNameToIndex[name];
}

function calculateKamiStats() {
  const result = {};
  Object.entries(traitsData).forEach(([kamiId, traits]) => {
    const stats = { ...BASE_STATS };
    Object.entries(traits).forEach(([category, traitName]) => {
      const entry = lookupTrait(category, traitName);
      if (entry && entry.stats) {
        Object.entries(entry.stats).forEach(([statName, value]) => {
          if (Object.prototype.hasOwnProperty.call(stats, statName))
            stats[statName] += value;
        });
      }
    });
    result[kamiId] = { stats };
  });
  return result;
}

function processLoadedData() {
  traitNameToIndex = buildTraitNameToIndex();
  traitEntityToIndex = buildTraitEntityToIndex();
  kamiTraitIndexData = null; // free — lookup tables are now the source of truth
  totalNFTsCount = Object.keys(traitsData).length;
  kamiStatsData = calculateKamiStats();
  affinityData = extractAffinityData();
  traitAffinityLookup = buildTraitAffinityLookup();
  traitSignatures = buildTraitSignatures();
  traitCounts = calculateTraitCounts();
  nftRarityScores = calculateRarityScores();
  console.log("✅ OpenRarity calculation complete!");

  // Compute in-game ranks from kamiScores: sort by overall desc, then rarity desc
  kamiInGameRanks = {};
  const scoreEntries = Object.entries(kamiScoresData);
  if (scoreEntries.length > 0) {
    scoreEntries.sort((a, b) => {
      const overallDiff = (b[1][1] ?? -1) - (a[1][1] ?? -1);
      if (overallDiff !== 0) return overallDiff;
      return (b[1][0] ?? -1) - (a[1][0] ?? -1);
    });

    let currentRank = 1;
    let prevOverall = null;
    let prevRarity = null;

    scoreEntries.forEach(([id, scores], index) => {
      const overallScore = scores[1] ?? -1;
      const rarityScore = scores[0] ?? -1;

      // If it's not the first item, and either score differs from the previous, update the rank
      if (
        prevOverall !== null &&
        (overallScore !== prevOverall || rarityScore !== prevRarity)
      ) {
        currentRank = index + 1;
      }

      kamiInGameRanks[id] = currentRank;

      prevOverall = overallScore;
      prevRarity = rarityScore;
    });

    console.log("✅ In-game rank calculation complete!");
  }
}

async function loadData() {
  try {
    console.log("📄 Loading bundle with cache-busting...");
    const v = Date.now();

    await Promise.all([
      fetchAndSplitBundle(v),
      loadSacrificeData(v),
      loadListingsData(v),
    ]);
    await loadKamiInfoData(v);

    if (metadataInfo.newKamiIds?.length > 0) {
      console.log(`✨ Found ${metadataInfo.newKamiIds.length} new Kamigotchi!`);
      console.log(`   New IDs: ${metadataInfo.newKamiIds.join(", ")}`);
    }

    const mintPriceEl = document.getElementById("mint-price");
    const rerollPriceEl = document.getElementById("reroll-price");
    if (mintPriceEl && metadataInfo.mintPrice != null)
      mintPriceEl.textContent = metadataInfo.mintPrice.toLocaleString();
    if (rerollPriceEl && metadataInfo.rerollPrice != null)
      rerollPriceEl.textContent = metadataInfo.rerollPrice.toLocaleString();

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

    document
      .querySelectorAll(".sort-btn")
      .forEach((b) => b.classList.remove("active"));
    if (!currentListingSortOrder) {
      document
        .querySelector(`.sort-btn[data-sort="${currentSortOrder}"]`)
        ?.classList.add("active");
    }
    document
      .getElementById("cloneFilterBtn")
      ?.classList.toggle("active", isShowingClonesOnly);
    document
      .getElementById("listingFilterBtn")
      ?.classList.toggle("active", isShowingListingOnly);

    const listingSortSection = document.querySelector(".listing-sort-section");
    if (listingSortSection)
      listingSortSection.style.display = isShowingListingOnly
        ? "block"
        : "none";
    if (isShowingListingOnly && currentListingSortOrder) {
      document
        .querySelector(
          `.listing-sort-btn[listing-data-sort="${currentListingSortOrder}"]`,
        )
        ?.classList.add("active");
    }

    updateSelectedIDsDisplay();
    allNFTIds = getSortedNFTIds();

    const _urlParamsInit = new URLSearchParams(window.location.search);
    if (_urlParamsInit.get("tradehistory") === "true") {
      // Set flag early so the updateURL patch below preserves tradehistory=true in URL.
      // Also prime listingFilterBtn + listing-sort-section as trade history lives there.
      window.__tradeHistoryActive = true;
      document.getElementById("listingFilterBtn")?.classList.add("active");
      const _lss = document.querySelector(".listing-sort-section");
      if (_lss) _lss.style.display = "block";
    } else if (initialFilterActive) filterByTraits();
    else if (isShowingClonesOnly) filterClones();
    else if (isShowingListingOnly) filterListing();
    else loadInitialNFTs();

    updateURL(true);

    // Signal kami data is fully ready. trade-history.js hooks __onKamiDataReady so it
    // can safely call filterTradeHistory without racing against loadData.
    window.__kamiDataReady = true;
    if (typeof window.__onKamiDataReady === "function") {
      window.__onKamiDataReady();
      window.__onKamiDataReady = null;
    }

    const now = new Date();
    const label = `Last updated:\n${now.toLocaleDateString([], { month: "short", day: "numeric" })} ${now.toLocaleTimeString()}`;
    document
      .getElementById("refreshDataBtn")
      ?.setAttribute("data-tooltip", label);

    cachedListingsHash = getSignificantListingsHash(listingMetaInfo);
    cachedListingsMetaHash = JSON.stringify(listingMetaInfo.listingNewWindow);
    cachedMetaHash = getSignificantMetaHash(metadataInfo);
    cachedAccountsHash = JSON.stringify({}); // accountIdMap from kamiMeta.json; populated on first checkForUpdates tick
    startAutoRefresh();
  } catch (error) {
    console.error("Detailed error:", error);
    document.getElementById("results").innerHTML = `
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

  const refreshBtn = document.getElementById("refreshDataBtn");
  const originalText = refreshBtn.innerHTML;
  refreshBtn.disabled = true;

  // Capture scroll position before any async work so auto-refresh never jumps the page
  const savedScrollY = window.scrollY;
  const pinScroll = () => {
    if (window.scrollY !== savedScrollY)
      window.scrollTo({ top: savedScrollY, behavior: "instant" });
  };
  const scrollPinInterval = setInterval(pinScroll, 16);

  try {
    console.log("🔄 Refreshing data...");

    const currentFilters = getTraitStringFromState();
    const currentAffinityString = getAffinityStringFromState();
    const currentMinMaxString = getMinMaxStringFromState();
    const currentSort = currentSortOrder;
    const currentListingSort = currentListingSortOrder;
    const wasShowingClones = isShowingClonesOnly;
    const wasShowingListing = isShowingListingOnly;
    const wasTradeHistory = !!window.__tradeHistoryActive;

    const v = Date.now();
    await Promise.all([
      fetchAndSplitBundle(v),
      loadSacrificeData(v),
      loadListingsData(v),
      typeof window._reloadTradeHistory === "function"
        ? window._reloadTradeHistory()
        : Promise.resolve(),
    ]);

    await loadKamiInfoData(v);

    if (metadataInfo.newKamiIds?.length > 0) {
      console.log(`✨ Found ${metadataInfo.newKamiIds.length} new Kamigotchi!`);
      console.log(`   New IDs: ${metadataInfo.newKamiIds.join(", ")}`);
    }

    const mintPriceEl = document.getElementById("mint-price");
    const rerollPriceEl = document.getElementById("reroll-price");
    if (mintPriceEl && metadataInfo.mintPrice != null)
      mintPriceEl.textContent = metadataInfo.mintPrice.toLocaleString();
    if (rerollPriceEl && metadataInfo.rerollPrice != null)
      rerollPriceEl.textContent = metadataInfo.rerollPrice.toLocaleString();

    processLoadedData();

    currentSortOrder = currentSort;
    currentListingSortOrder = currentListingSort;
    isShowingClonesOnly = wasShowingClones;
    isShowingListingOnly = wasShowingListing;
    allNFTIds = getSortedNFTIds();

    const filterControls = document.getElementById("filterControls");
    const visibleFilterGroup = document.querySelector(
      '.filter-group[style*="display: block"], .filter-group[style*="display:block"]',
    );
    const visibleTraitType = visibleFilterGroup
      ? visibleFilterGroup.dataset.traitType
      : null;
    const affinityWasVisible =
      document.querySelector(".affinity-filter-section")?.style.display ===
      "block";
    const minmaxWasVisible =
      document.querySelector(".minmax-filter-section")?.style.display ===
      "block";
    filterControls.innerHTML = "";
    createFilterControls();
    if (visibleTraitType) {
      const restoredGroup = document.querySelector(
        `.filter-group[data-trait-type="${visibleTraitType}"]`,
      );
      if (restoredGroup) restoredGroup.style.display = "block";
      const dropdown = document.getElementById("traitCategoryDropdown");
      if (dropdown) dropdown.value = visibleTraitType;
    }

    if (currentFilters || currentAffinityString || currentMinMaxString) {
      const originalSearch = window.location.search;
      const params = new URLSearchParams();
      if (currentFilters) params.set("traits", currentFilters);
      if (currentAffinityString) params.set("affinity", currentAffinityString);
      if (currentMinMaxString) params.set("minmax", currentMinMaxString);
      history.replaceState(null, "", `?${params.toString()}`);
      loadStateFromURL({ restorePanels: false });
      history.replaceState(null, "", originalSearch);
      currentListingSortOrder = currentListingSort;
      isShowingClonesOnly = wasShowingClones;
      isShowingListingOnly = wasShowingListing;
    }

    const affinitySection = document.querySelector(".affinity-filter-section");
    const affinityToggle = document.getElementById("affinityFilterToggle");
    if (affinitySection)
      affinitySection.style.display = affinityWasVisible ? "block" : "none";
    if (affinityToggle)
      affinityToggle.classList.toggle("active", affinityWasVisible);

    const minmaxSection = document.querySelector(".minmax-filter-section");
    const minmaxToggle = document.getElementById("minmaxFilterToggle");
    if (minmaxSection)
      minmaxSection.style.display = minmaxWasVisible ? "block" : "none";
    if (minmaxToggle) minmaxToggle.classList.toggle("active", minmaxWasVisible);

    document
      .getElementById("cloneFilterBtn")
      ?.classList.toggle("active", isShowingClonesOnly);
    document
      .getElementById("listingFilterBtn")
      ?.classList.toggle("active", isShowingListingOnly || wasTradeHistory);

    const listingSortSectionRefresh = document.querySelector(
      ".listing-sort-section",
    );
    if (listingSortSectionRefresh)
      listingSortSectionRefresh.style.display =
        isShowingListingOnly || wasTradeHistory ? "block" : "none";
    document
      .querySelectorAll(".listing-sort-btn")
      .forEach((b) => b.classList.remove("active"));
    if (isShowingListingOnly && currentListingSortOrder) {
      document
        .querySelector(
          `.listing-sort-btn[listing-data-sort="${currentListingSortOrder}"]`,
        )
        ?.classList.add("active");
    }

    const hasAnyFilter =
      currentFilters || currentAffinityString || currentMinMaxString;
    if (wasTradeHistory) {
      document
        .getElementById("kami-trade-history-btn")
        ?.classList.add("active");
      if (typeof window._filterTradeHistory === "function") {
        preserveScroll(() => window._filterTradeHistory());
      }
    } else {
      preserveScroll(() => {
        if (
          isShowingClonesOnly &&
          !(isShowingListingOnly && currentListingSortOrder)
        )
          filterClones();
        else if (isShowingListingOnly) filterListing();
        else if (hasAnyFilter) filterByTraits();
        else {
          isFiltering = false;
          loadInitialNFTs();
        }
      });
    }

    if (selectedIDs.size > 0) updateSelectedIDsDisplay();

    updateURL(true);

    // DOM is now settled — stop pinning and do one final restoration
    clearInterval(scrollPinInterval);
    requestAnimationFrame(() => {
      requestAnimationFrame(pinScroll);
    });

    refreshBtn.innerHTML = `<svg id="refreshComplete" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><mask id="SVGkzXYXbbR"><g fill="none" stroke="#fff" stroke-dasharray="24" stroke-dashoffset="24" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.4s" values="24;0"/></path><path stroke="#000" stroke-width="6" d="M7.5 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.4s" dur="0.4s" values="24;0"/></path><path d="M7.5 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.4s" dur="0.4s" values="24;0"/></path></g></mask><rect width="24" height="24" fill="currentColor" mask="url(#SVGkzXYXbbR)"/></svg>`;
    setTimeout(() => {
      refreshBtn.innerHTML = originalText;
      refreshBtn.disabled = false;
      refreshBtn.style.opacity = "1";
      isRefreshing = false;
      const now = new Date();
      const label = `Last updated: ${now.toLocaleDateString([], { month: "short", day: "numeric" })} ${now.toLocaleTimeString()}`;
      document
        .getElementById("refreshDataBtn")
        ?.setAttribute("data-tooltip", label);
    }, 2000);
  } catch (error) {
    clearInterval(scrollPinInterval);
    console.error("Error refreshing data:", error);
    const messageBox = document.getElementById("messageBox");
    messageBox.textContent = "Failed to refresh data. Please try again.";
    messageBox.style.display = "block";
    setTimeout(() => (messageBox.style.display = "none"), 3000);
    refreshBtn.innerHTML = originalText;
    refreshBtn.disabled = false;
    refreshBtn.style.opacity = "1";
    isRefreshing = false;
  }
}

// ============================================================
// SCROLL TO TOP
// ============================================================

function setupScrollToTop() {
  const scrollBtn = document.getElementById("scrollToTop");
  let lastScrollTop = 0;
  let _scrollRafPending = false;

  window.addEventListener("scroll", () => {
    if (_scrollRafPending) return;
    _scrollRafPending = true;
    requestAnimationFrame(() => {
      _scrollRafPending = false;
      const currentScroll = window.pageYOffset;
      if (currentScroll > 300) {
        scrollBtn.classList.toggle("show", currentScroll > lastScrollTop);
      } else {
        scrollBtn.classList.remove("show");
      }
      lastScrollTop = currentScroll;
    });
  });

  scrollBtn.addEventListener("click", () =>
    window.scrollTo({ top: 0, behavior: "smooth" }),
  );
}

function setupRefreshButton() {
  document
    .getElementById("refreshDataBtn")
    ?.addEventListener("click", refreshData);
}

// ============================================================
// INIT
// ============================================================

document.getElementById("searchBtn").addEventListener("click", searchByID);
document.getElementById("searchInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") searchByID();
});
document
  .getElementById("clearSearchBtn")
  .addEventListener("click", clearAllSelectedIDs);
document.getElementById("clearBtn").addEventListener("click", clearFilters);

document.addEventListener("DOMContentLoaded", () => {
  setupScrollToTop();
  setupRefreshButton();

  document.getElementById("sc-toggle-btn")?.addEventListener("click", () => {
    const player = document.getElementById("soundcloud-player");
    if (!player.classList.contains("sc-open") && window.umami)
      umami.track("check-music");
  });

  document
    .querySelectorAll(".mint-price-text, .reroll-price-text")
    .forEach((el) => {
      el.addEventListener("click", () => {
        const tag = el.classList.contains("mint-price-text")
          ? "mint-price-text"
          : "reroll-price-text";
        if (window.umami) umami.track("price-check", { tag });
        el.style.webkitTextFillColor = "#333";
        el.style.color = "#333";
        setTimeout(() => {
          el.style.webkitTextFillColor = "#bbeebb";
          el.style.color = "#bbeebb";
        }, 2000);
      });
    });

  window.addEventListener("popstate", handlePopState);

  document.addEventListener("click", (e) => {
    // Cards are dismissed only via their close button, not outside clicks
    const filterControls = document.getElementById("filterControls");
    if (filterControls && !filterControls.contains(e.target)) {
      document
        .querySelectorAll(".filter-group")
        .forEach((group) => (group.style.display = "none"));
      const dropdown = document.getElementById("traitCategoryDropdown");
      if (dropdown) {
        dropdown.dataset.value = "";
        dropdown.classList.remove("custom-select--open");
        const opts = dropdown.querySelector(".custom-select__options");
        if (opts) opts.style.display = "none";
        const txt = dropdown.querySelector(".custom-select__selected span");
        if (txt) txt.textContent = "-- Choose a category --";
      }
    }
  });

  // SoundCloud player initialisation is handled by soundcloud-player.js
});

if (!document.getElementById("enhanced-trait-styles")) {
  const styleTag = document.createElement("style");
  styleTag.id = "enhanced-trait-styles";
    document.head.appendChild(styleTag);

  const messageBox = document.createElement("div");
  messageBox.id = "messageBox";
  document.body.appendChild(messageBox);

  document.addEventListener("mouseover", (e) => {
    const badge = e.target.closest(".listing-badge, .new-listing-icon");
    if (badge) {
      const related = e.relatedTarget;
      if (!related || !badge.contains(related)) {
        const price = badge
          .closest(".image-container")
          ?.querySelector(".listing-price");
        if (price) price.style.opacity = "0.7";
      }
    }
    const timeIcon = e.target.closest(".listing-time-ago");
    if (timeIcon) {
      const related = e.relatedTarget;
      if (!related || !timeIcon.contains(related)) {
        const timeEl = timeIcon
          .closest(".nft-card")
          ?.querySelector(".image-container .listing-time");
        if (timeEl) timeEl.style.opacity = "0.7";
      }
    }
  });
  document.addEventListener("mouseout", (e) => {
    const badge = e.target.closest(".listing-badge, .new-listing-icon");
    if (badge) {
      const related = e.relatedTarget;
      if (!related || !badge.contains(related)) {
        const price = badge
          .closest(".image-container")
          ?.querySelector(".listing-price");
        if (price) price.style.opacity = "";
      }
    }
    const timeIcon = e.target.closest(".listing-time-ago");
    if (timeIcon) {
      const related = e.relatedTarget;
      if (!related || !timeIcon.contains(related)) {
        const timeEl = timeIcon
          .closest(".nft-card")
          ?.querySelector(".image-container .listing-time");
        if (timeEl) timeEl.style.opacity = "";
      }
    }
  });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((r) => r.unregister());
  });
  caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
}

loadData();
