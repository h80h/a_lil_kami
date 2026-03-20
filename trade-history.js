// ============================================================
// KAMI TRADE HISTORY — overlay page 3
// Injects into the existing card overlay cycle (0→1→2→3→0)
// ============================================================

(function () {

  // Tracks the current overlay page. Kept in sync by the patched applyKamiPage
  // below, which is the single authoritative call-site for every page change.
  let _currentPage = 0;

  // --------------------------------------------------------
  // DATA
  // --------------------------------------------------------

  let kamiHistoryMap = new Map();
  let accountNameMap = new Map();
  let tradeNewWindow = {};

  function getBaseUrl() {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.');
    return isLocal ? 'https://data.kami.h80h.xyz' : '/api/data';
  }

  async function loadAccountNames() {
    try {
      const res = await fetch(`${getBaseUrl()}/kamiBundle.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(`Failed to load kamiBundle.json for trade-history: ${res.status}`);
      const bundle = await res.json();
      const accounts = bundle?.kamiAccounts ?? {};
      for (const acc of Object.values(accounts)) {
        if (acc.id && acc.name) accountNameMap.set(String(acc.id), acc.name);
      }
    } catch (err) {
      console.warn('📜 Account name load failed:', err);
    }
  }

  async function loadHistoryData() {
    try {
      const res = await fetch(`${getBaseUrl()}/kamiMarketHistory.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(`Failed to load kamiMarketHistory.json for trade-history: ${res.status}`);
      const data = await res.json();
      // Support new shape { history, tradeNewWindow } and legacy bare array
      const records = Array.isArray(data) ? data : (data?.history ?? []);
      tradeNewWindow = (!Array.isArray(data) && data?.tradeNewWindow) ? data.tradeNewWindow : {};
      kamiHistoryMap.clear();
      for (const record of records) {
        const key = String(record.kamiId);
        if (!kamiHistoryMap.has(key)) kamiHistoryMap.set(key, []);
        kamiHistoryMap.get(key).push(record);
      }
      console.log(`📜 Loaded trade history for ${kamiHistoryMap.size} kami(s)`);
    } catch (err) {
      console.warn('📜 Trade history failed to load:', err);
    }
  }

  async function pollMeta() {
    try {
      const res = await fetch(`${getBaseUrl()}/kamiMarketHistoryMeta.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(`Failed to load kamiMarketHistoryMeta.json for trade-history: ${res.status}`);
      const meta = await res.json();
      if (meta?.tradeNewWindow && Object.keys(meta.tradeNewWindow).length > 0) {
        console.log('📜 New trades detected — refreshing data');
        if (typeof window.refreshData === 'function') await window.refreshData();
      }
    } catch (err) {
      console.warn('📜 Meta poll failed:', err);
    }
  }

  // --------------------------------------------------------
  // HTML BUILDER
  // --------------------------------------------------------

  function resolveAccount(rawId) {
    if (!rawId) return '—';
    return accountNameMap.get(String(rawId))
  }

  function timeAgo(dateStr) {
    if (!dateStr) return null;
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 0) return null;
    const m = Math.floor(diff / 60000);
    if (m < 60)   return m <= 1 ? 'just now' : `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)   return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30)   return `${d}d ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12)  return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
  }

  function getHistoryHTML(id) {
    const records = kamiHistoryMap.get(String(id));

    if (!records || records.length === 0) {
      return `<div class="kami-history"><div class="kami-history-empty">no trades yet</div></div>`;
    }

    // Find the latest tradeTime across all records with a tradeTime
    const latestTradeTime = records.reduce((latest, r) => {
      if (!r.tradeTime) return latest;
      return (!latest || r.tradeTime > latest) ? r.tradeTime : latest;
    }, null);
    const ago = latestTradeTime ? timeAgo(latestTradeTime) : null;
    const badgeHTML = ago
      ? `<span class="last-trade-badge">${ago}</span>`
      : '';

    const rows = [...records].reverse().map(r => {
      const tradeTime = r.tradeTime ? new Date(r.tradeTime).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '???';
      const tag    = r.type === 'bid' ? 'offer' : 'sale';
      const seller = resolveAccount(r.seller);
      const buyer  = resolveAccount(r.buyer);
      const isNew = tradeNewWindow[r.orderId] > 0;
      return `<div class="kami-history-row${isNew ? ' kami-history-row-new' : ''}">
        <div class="kami-history-row-top">
          <span class="kami-history-price">Ξ${r.price}</span>
          <span class="kami-history-type ${r.type}">${tag}</span>
        </div>
        <div class="kami-history-row-bottom">
          <span class="kami-history-seller">${seller}</span>
          <span class="kami-history-arrow">=></span>
          <span class="kami-history-buyer">${buyer}</span>
        </div>
        <span class="kami-history-tradetime">${tradeTime}</span>
      </div>`;
    }).join('');

    return `<div class="kami-history" id="kami-history-panel">
      <div class="kami-history-header">${records.length} sale(s) ${badgeHTML}</div>
      <div class="kami-history-rows">${rows}</div>
    </div>`;
  }

  // --------------------------------------------------------
  // PATCH
  // --------------------------------------------------------

  function patchOverlay() {
    if (
      typeof window.getOverlaySlotHTML === 'undefined' ||
      typeof window.applyKamiPage === 'undefined'
    ) {
      setTimeout(patchOverlay, 200);
      return;
    }

    const _orig = window.getOverlaySlotHTML;
    window.getOverlaySlotHTML = function (id, page) {
      if (page === 3) return getHistoryHTML(id);
      return _orig(id, page);
    };

    const _origApply = window.applyKamiPage;
    window.applyKamiPage = function (page) {
      _currentPage = page;
      _origApply(page);
      document.querySelectorAll('.kami-overlay-controls').forEach(ctrl => {
        ctrl.classList.toggle('kami-history-visible', page === 3);
      });
    };

    function scrollHistory(panel, direction) {
      if (!panel) return;
      const rows = Array.from(panel.querySelectorAll('.kami-history-row'));
      if (!rows.length) return;
      const panelTop = panel.getBoundingClientRect().top;
      const tops = rows.map(row => panel.scrollTop + row.getBoundingClientRect().top - panelTop);
      if (direction === 'down') {
        const next = tops.find(top => top > panel.scrollTop + 1);
        panel.scrollTop = next !== undefined ? next : panel.scrollHeight;
      } else {
        const prev = [...tops].reverse().find(top => top < panel.scrollTop - 1);
        panel.scrollTop = prev !== undefined ? prev : 0;
      }
    }

    function patchArrow(arrow) {
      if (arrow.dataset.historyPatched) return;
      arrow.dataset.historyPatched = '1';
      const newArrow = arrow.cloneNode(true);
      arrow.parentNode.replaceChild(newArrow, arrow);
      newArrow.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextPage = (_currentPage + 1) % 4;
        window.applyKamiPage(nextPage);
      });

      // Inject scroll buttons into .kami-overlay-controls (z-index 20, pointer-events: auto when active)
      // positioned absolutely at the bottom-center to overlay the slot
      const controls = newArrow.closest('.kami-overlay-controls');
      if (controls && !controls.dataset.scrollInjected) {
        controls.dataset.scrollInjected = '1';
        const card = controls.closest('.nft-card');

        const upBtn = document.createElement('button');
        upBtn.className = 'kami-history-up';
        upBtn.textContent = '△';

        const downBtn = document.createElement('button');
        downBtn.className = 'kami-history-down';
        downBtn.textContent = '▽';

        const bar = document.createElement('div');
        bar.className = 'kami-history-scroll-btns';
        bar.appendChild(upBtn);
        bar.appendChild(downBtn);
        controls.appendChild(bar);

        // Sync visibility immediately in case cards re-rendered while on page 3
        controls.classList.toggle('kami-history-visible', _currentPage === 3);

        upBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          scrollHistory(card?.querySelector('.kami-history-rows'), 'up');
        });
        downBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          scrollHistory(card?.querySelector('.kami-history-rows'), 'down');
        });
      }
    }

    function patchAllArrows() {
      document.querySelectorAll('.kami-overlay-arrow:not([data-history-patched])').forEach(patchArrow);
    }

    patchAllArrows();
    const observerTarget = document.getElementById('results') || document.body;
    new MutationObserver(() => patchAllArrows()).observe(observerTarget, { childList: true, subtree: true });
    const selectedIDsTarget = document.getElementById('selectedIDs');
    if (selectedIDsTarget) new MutationObserver(() => patchAllArrows()).observe(selectedIDsTarget, { childList: true, subtree: true });

    let pollCount = 0;
    const poll = setInterval(() => { patchAllArrows(); if (++pollCount >= 20) clearInterval(poll); }, 200);
  }

  const style = document.createElement('style');
  style.textContent = `
    
  `;
  document.head.appendChild(style);

  // --------------------------------------------------------
  // TRADE HISTORY FILTER
  // --------------------------------------------------------

  let isShowingTradeHistory = false;
  // Saves the full URL search string (e.g. "?listing=true&listing-sort=price")
  // that was active before entering trade history, so we can restore it exactly.
  let _savedSearch = '';

  function getKamisWithTradeTime() {
    const result = [];
    kamiHistoryMap.forEach((records, kamiId) => {
      const latestTradeTime = records.reduce((max, r) => {
        if (!r.tradeTime) return max;
        const t = new Date(r.tradeTime).getTime();
        return t > max ? t : max;
      }, 0);
      if (latestTradeTime > 0) result.push({ kamiId, latestTradeTime });
    });
    result.sort((a, b) => b.latestTradeTime - a.latestTradeTime);
    return result;
  }

function filterTradeHistory() {
    if (typeof window.applyKamiPage !== 'function') return;

    const resultsDiv = document.getElementById('results');
    if (!resultsDiv) return;

    // Reset only sort/listing-sort; traits, affinity, min-max, clone stay active
    window.resetAllFilters();

    resultsDiv.textContent = '';

    const traded = getKamisWithTradeTime();

    // Start with traded IDs that exist in the dataset
    let validIds = traded
      .map(({ kamiId }) => kamiId)
      .filter(id => typeof traitsData !== 'undefined' ? traitsData[id] !== undefined : true);

    // Apply clone filter if active
    if (window.isShowingClonesOnly) {
      const cloneIds = window.traitSignatures?.cloneIds;
      if (cloneIds) validIds = validIds.filter(id => cloneIds.has(id));
    }

    // Apply trait checkboxes
    const selectedTraits = window.getSelectedTraitsFromCheckboxes();
    const hasTraitFilters = Object.keys(selectedTraits).length > 0;
    if (hasTraitFilters) {
      validIds = validIds.filter(id => window.matchesSelectedTraits(id, selectedTraits));
    }

    // Apply affinity filters
    const bodyAff = window.selectedBodyAffinities;
    const handAff = window.selectedHandAffinities;
    if (bodyAff?.size > 0 || handAff?.size > 0) {
      validIds = validIds.filter(id => {
        const a = window.affinityData?.[id];
        return a
          && (bodyAff.size === 0 || bodyAff.has(a.body))
          && (handAff.size === 0 || handAff.has(a.hand));
      });
    }

    // Apply stat min/max filters
    if (window.hasActiveStatFilters()) {
      validIds = validIds.filter(id => window.passesStatMinMaxFilters(id));
    }

    window.setFilteredNFTIds(validIds);

    // Build filter summary buttons the same way other views do
    const filterSummaryHTML = hasTraitFilters
      ? `<div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">${window.buildTraitSummaryButtonsHTML(selectedTraits)}</div>`
      : '';

    window.appendCountHeader(
      resultsDiv,
      `Trade History: ${validIds.length} sold Kamigotchi${window.getAffinityNotation ? window.getAffinityNotation() : ''}`,
      filterSummaryHTML
    );

    // Always sync URL with active co-filters + tradehistory=true, even when 0 results.
    if (typeof window.updateURL === 'function') window.updateURL(true);

    if (validIds.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'no-results';
      noResults.textContent = 'No trade history found';
      resultsDiv.appendChild(noResults);
      return;
    }

    window.loadMoreNFTs();
    window.setupInfiniteScroll();

    requestAnimationFrame(() => {
      window.applyKamiPage(3);
    });
  }

  // Expose so the updateSelectedTraitsDisplay patch in script.js can call it
  window._filterTradeHistory = filterTradeHistory;

  // Expose so refreshData in script.js can reload market history on demand
  window._reloadTradeHistory = loadHistoryData;

  function activateTradeHistory() {
    _savedSearch = window.location.search;
    isShowingTradeHistory = true;
    window.__tradeHistoryActive = true;
    document.getElementById('kami-trade-history-btn')?.classList.add('active');
    // Push the history entry first; filterTradeHistory's updateURL(true) will
    // replaceState on top of it to add any active co-filter params.
    history.pushState({ tradeHistory: true }, '', '?tradehistory=true');
    filterTradeHistory();
  }

  function deactivateTradeHistory(skipRestore) {
    isShowingTradeHistory = false;
    window.__tradeHistoryActive = false;
    document.getElementById('kami-trade-history-btn')?.classList.remove('active');
    if (typeof window.applyKamiPage === 'function') window.applyKamiPage(0);
    if (!skipRestore) {
      // Start from _savedSearch (preserves listing=true, listing-sort, sort, etc. that were
      // active before trade history) then overlay co-filters from the current URL (clones,
      // traits, affinity, minmax) which filterTradeHistory → updateURL keeps up to date.
      // When _savedSearch is empty (page loaded with ?tradehistory=true directly), default
      // to listing=true so sort/listing-sort buttons land in the listing context, not all-NFTs.
      const baseSearch   = _savedSearch || '?listing=true';
      const savedParams  = new URLSearchParams(baseSearch);
      const currentParams = new URLSearchParams(window.location.search);
      for (const key of ['clones', 'traits', 'affinity', 'minmax']) {
        const val = currentParams.get(key);
        if (val !== null) savedParams.set(key, val);
        else savedParams.delete(key);
      }
      const restoreSearch = savedParams.toString() ? `?${savedParams.toString()}` : '';
      history.replaceState(null, '', restoreSearch || window.location.pathname);
      if (typeof window.handlePopState === 'function') window.handlePopState();
    } else {
      // No restore — rebuild URL from current filter state (strips tradehistory=true since
      // __tradeHistoryActive is now false so the updateURL patch won't re-add it).
      if (typeof window.updateURL === 'function') window.updateURL(true);
    }
    _savedSearch = '';
  }

  function setupTradeHistoryButton() {
    const btn = document.getElementById('kami-trade-history-btn');
    if (!btn) { setTimeout(setupTradeHistoryButton, 300); return; }

    btn.addEventListener('click', () => {
      if (!isShowingTradeHistory) {
        activateTradeHistory();
      }
      // When already active, clicking the button again does nothing —
      // only other sort/filter buttons can exit history mode.
    });

    // Any sort or listing-sort button click while trade history is active → deactivate first.
    // Trait, affinity, minmax, clone button clicks re-run filterTradeHistory with updated filters.
    document.addEventListener('click', (e) => {
      if (!isShowingTradeHistory) return;
      const isSortBtn        = e.target.closest('.sort-btn');
      const isListingSortBtn = e.target.closest('.listing-sort-btn:not(#kami-trade-history-btn)');
      const isListingBtn     = e.target.closest('#listingFilterBtn');
      if (isSortBtn || isListingSortBtn) {
        deactivateTradeHistory();
        return;
      }
      // listingFilterBtn: deactivate history, then force isShowingListingOnly=true so the
      // bubble toggle (!isShowingListingOnly) lands on false — ensuring listing=true is NOT
      // written to the URL and .listing-sort-section stays hidden.
      if (isListingBtn) {
        deactivateTradeHistory(true);
        window.setIsShowingListingOnly(true);
        return;
      }
      // For filters that co-exist with history, re-run after the button's own handler settles
      const isCloneBtn       = e.target.closest('#cloneFilterBtn');
      const isAffinityBtn    = e.target.closest('.affinity-btn');
      const isAffinityToggle = e.target.closest('#affinityFilterToggle');
      const isMinmaxToggle   = e.target.closest('#minmaxFilterToggle');
      const isClearBtn       = e.target.closest('#clearBtn');
      const isTraitCheckbox  = e.target.closest('.trait-checkbox');
      const isStatSlider     = e.target.closest('.stat-control-input');
      const isStatToggle     = e.target.closest('.toggle-input');
      if (isCloneBtn || isAffinityBtn || isAffinityToggle || isMinmaxToggle ||
          isClearBtn || isTraitCheckbox) {
        // Let the original handler fire first (bubble), then re-filter
        setTimeout(() => { if (isShowingTradeHistory) filterTradeHistory(); }, 0);
      }
      // isStatSlider and isStatToggle are handled by triggerStatFilter() in script.js,
      // which now delegates to filterTradeHistory() when trade history is active.
    }, true); // capture phase

    // Handle browser back/forward
    window.addEventListener('popstate', () => {
      const params = new URLSearchParams(window.location.search);
      const wantsHistory = params.get('tradehistory') === 'true';
      if (wantsHistory && !isShowingTradeHistory) {
        isShowingTradeHistory = true;
        window.__tradeHistoryActive = true;
        document.getElementById('kami-trade-history-btn')?.classList.add('active');
        filterTradeHistory();
      } else if (!wantsHistory && isShowingTradeHistory) {
        isShowingTradeHistory = false;
        window.__tradeHistoryActive = false;
        document.getElementById('kami-trade-history-btn')?.classList.remove('active');
        if (typeof window.applyKamiPage === 'function') window.applyKamiPage(0);
      }
    });

    // If page loaded with ?tradehistory=true in URL, activate immediately —
    // but only once kami data (traitsData etc.) is ready, to avoid a race with loadData().
    if (new URLSearchParams(window.location.search).get('tradehistory') === 'true') {
      isShowingTradeHistory = true;
      window.__tradeHistoryActive = true;
      btn.classList.add('active');
      if (window.__kamiDataReady) {
        filterTradeHistory();
      } else {
        window.__onKamiDataReady = filterTradeHistory;
      }
    }
  }

  // --------------------------------------------------------
  // INIT.
  // --------------------------------------------------------

  Promise.all([loadHistoryData(), loadAccountNames()]).then(() => {
    setInterval(pollMeta, 5 * 60 * 1000);
    setupTradeHistoryButton();
  });

  patchOverlay();

})();