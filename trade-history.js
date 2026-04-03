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

  function getBaseUrl() {
    const isLocal =
      window.location.hostname === "localhost" ||
      window.location.hostname.startsWith("192.168.");
    return isLocal ? "https://data.kami.h80h.xyz" : "/api/data";
  }

  async function loadAccountNames() {
    try {
      const meta = await fetch(
        `${getBaseUrl()}/kamiMeta.json?v=${Date.now()}`,
      ).then((r) => (r.ok ? r.json() : null));
      const accounts = meta?.kamiAccounts ?? null;

      if (accounts && Object.keys(accounts).length > 0) {
        // kamiMeta.json already has kamiAccounts (new extractor)
        for (const acc of Object.values(accounts)) {
          if (acc.id && acc.name) accountNameMap.set(String(acc.id), acc.name);
        }
      } else {
        // Fall back to kamiBundle.json (old extractor or first deploy)
        const bundle = await fetch(
          `${getBaseUrl()}/kamiBundle.json?v=${Date.now()}`,
        ).then((r) => (r.ok ? r.json() : null));
        const bundleAccounts = bundle?.kamiAccounts ?? {};
        for (const acc of Object.values(bundleAccounts)) {
          if (acc.id && acc.name) accountNameMap.set(String(acc.id), acc.name);
        }
      }
    } catch (err) {
      console.warn("📜 Account name load failed:", err);
    }
  }

  async function loadHistoryData() {
    try {
      const res = await fetch(
        `${getBaseUrl()}/kamiMarketHistory.json?v=${Date.now()}`,
      );
      if (!res.ok)
        throw new Error(
          `Failed to load kamiMarketHistory.json for trade-history: ${res.status}`,
        );
      const data = await res.json();
      // Support new shape { history } and legacy bare array
      const records = Array.isArray(data) ? data : (data?.history ?? []);
      kamiHistoryMap.clear();
      for (const record of records) {
        const key = String(record.kamiId);
        if (!kamiHistoryMap.has(key)) kamiHistoryMap.set(key, []);
        kamiHistoryMap.get(key).push(record);
      }
      console.log(`📜 Loaded trade history for ${kamiHistoryMap.size} kami(s)`);
    } catch (err) {
      console.warn("📜 Trade history failed to load:", err);
    }
  }

  let cachedHistoryCount = 0;

  async function pollMeta() {
    try {
      const res = await fetch(
        `${getBaseUrl()}/kamiMarketHistoryMeta.json?v=${Date.now()}`,
      );
      if (!res.ok) return;
      const meta = await res.json();
      const newCount = meta?.totalCount ?? 0;

      if (newCount !== cachedHistoryCount && cachedHistoryCount > 0) {
        const prevIds = new Set(
          [...kamiHistoryMap.keys()].flatMap((k) =>
            (kamiHistoryMap.get(k) || []).map((r) => r.orderId),
          ),
        );
        await loadHistoryData();
        const newTrades = [];
        kamiHistoryMap.forEach((records) =>
          records.forEach((r) => {
            if (!prevIds.has(r.orderId)) newTrades.push(r);
          }),
        );
        const kamiIds = [...new Set(newTrades.map((r) => r.kamiId))].sort(
          (a, b) => a - b,
        );
        console.log(
          `📜 Found ${newTrades.length} new trade(s) for: ${kamiIds.join(", ")}`,
        );
        if (
          window.__tradeHistoryActive &&
          typeof window._filterTradeHistory === "function"
        ) {
          window._filterTradeHistory();
        }
      }

      cachedHistoryCount = newCount;
    } catch (err) {
      console.warn("📜 Meta poll failed:", err);
    }
  }

  // --------------------------------------------------------
  // HTML BUILDER
  // --------------------------------------------------------

  function resolveAccount(rawId) {
    if (!rawId) return "—";
    return accountNameMap.get(String(rawId)) ?? "—";
  }

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

  function getHistoryHTML(id) {
    const records = kamiHistoryMap.get(String(id));

    if (!records || records.length === 0) {
      return `<div class="kami-history"><div class="kami-history-empty">no trades yet</div></div>`;
    }

    // Find the latest tradeTime across all records with a tradeTime
    const latestTradeTime = records.reduce((latest, r) => {
      if (!r.tradeTime) return latest;
      return !latest || r.tradeTime > latest ? r.tradeTime : latest;
    }, null);
    const ago = latestTradeTime ? timeAgo(latestTradeTime) : null;
    const badgeHTML = ago ? `<span class="last-trade-badge">${ago}</span>` : "";

    // Explicitly sort by tradeTime descending so the newest trade is always on top
    const rows = [...records]
      .sort((a, b) => {
        const timeA = a.tradeTime ? new Date(a.tradeTime).getTime() : 0;
        const timeB = b.tradeTime ? new Date(b.tradeTime).getTime() : 0;
        return timeB - timeA;
      })
      .map((r) => {
        const tradeTime = r.tradeTime
          ? new Date(r.tradeTime).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "???";
        const tag = r.type === "bid" ? "offer" : "sale";
        const seller = resolveAccount(r.seller);
        const buyer = resolveAccount(r.buyer);
        return `<div class="kami-history-row">
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
      })
      .join("");

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
      typeof window.getOverlaySlotHTML === "undefined" ||
      typeof window.applyKamiPage === "undefined"
    ) {
      setTimeout(patchOverlay, 200);
      return;
    }

    // Handle scroll button states dynamically based on scroll position
    function updateScrollButtons(panel) {
      if (!panel) return;
      const card = panel.closest(".nft-card");
      if (!card) return;
      const upBtn = card.querySelector(".kami-history-up");
      const downBtn = card.querySelector(".kami-history-down");
      if (!upBtn || !downBtn) return;

      const isAtTop = panel.scrollTop <= 1;
      const isAtBottom =
        Math.ceil(panel.scrollTop + panel.clientHeight) >=
        panel.scrollHeight - 1;

      upBtn.disabled = isAtTop;
      downBtn.disabled = isAtBottom;
    }

    // Capture scrolling globally to easily grab events from dynamically created panels
    if (!window.__tradeHistoryScrollBound) {
      window.__tradeHistoryScrollBound = true;
      document.addEventListener(
        "scroll",
        (e) => {
          if (
            e.target &&
            e.target.classList &&
            e.target.classList.contains("kami-history-rows")
          ) {
            updateScrollButtons(e.target);
          }
        },
        true,
      ); // `true` ensures it captures in the capture phase before bubbling stops
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
      document.querySelectorAll(".kami-overlay-controls").forEach((ctrl) => {
        ctrl.classList.toggle("kami-history-visible", page === 3);
      });
      // Force an immediate evaluation of the scroll buttons when a user lands on the history page
      if (page === 3) {
        requestAnimationFrame(() => {
          document
            .querySelectorAll(".kami-history-rows")
            .forEach(updateScrollButtons);
        });
      }
    };

    function scrollHistory(panel, direction) {
      if (!panel) return;
      const rows = Array.from(panel.querySelectorAll(".kami-history-row-top"));
      if (!rows.length) return;
      const panelTop = panel.getBoundingClientRect().top;
      const tops = rows.map(
        (row) => panel.scrollTop + row.getBoundingClientRect().top - panelTop,
      );
      if (direction === "down") {
        const next = tops.find((top) => top > panel.scrollTop + 1);
        panel.scrollTop = next !== undefined ? next : panel.scrollHeight;
      } else {
        const prev = [...tops]
          .reverse()
          .find((top) => top < panel.scrollTop - 1);
        panel.scrollTop = prev !== undefined ? prev : 0;
      }
      // Ensure buttons reflect the new state after manually changing scrollTop
      requestAnimationFrame(() => updateScrollButtons(panel));
    }

    function patchArrow(arrow) {
      if (arrow.dataset.historyPatched) return;
      arrow.dataset.historyPatched = "1";
      const newArrow = arrow.cloneNode(true);
      arrow.parentNode.replaceChild(newArrow, arrow);
      newArrow.addEventListener("click", (e) => {
        e.stopPropagation();
        const nextPage = (_currentPage + 1) % 4;
        window.applyKamiPage(nextPage);
      });

      // Inject scroll buttons into .kami-overlay-controls (z-index 20, pointer-events: auto when active)
      // positioned absolutely at the bottom-center to overlay the slot
      const controls = newArrow.closest(".kami-overlay-controls");
      if (controls && !controls.dataset.scrollInjected) {
        controls.dataset.scrollInjected = "1";
        const card = controls.closest(".nft-card");

        const upBtn = document.createElement("button");
        upBtn.className = "kami-history-up";
        upBtn.textContent = "△";

        const downBtn = document.createElement("button");
        downBtn.className = "kami-history-down";
        downBtn.textContent = "▽";

        const bar = document.createElement("div");
        bar.className = "kami-history-scroll-btns";
        bar.appendChild(upBtn);
        bar.appendChild(downBtn);
        controls.appendChild(bar);

        // Sync visibility immediately in case cards re-rendered while on page 3
        controls.classList.toggle("kami-history-visible", _currentPage === 3);

        // Immediate check in case injected while already on page 3
        if (_currentPage === 3) {
          requestAnimationFrame(() => {
            updateScrollButtons(card?.querySelector(".kami-history-rows"));
          });
        }

        upBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const liveCard = upBtn.closest(".nft-card");
          scrollHistory(liveCard?.querySelector(".kami-history-rows"), "up");
        });
        downBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const liveCard = downBtn.closest(".nft-card");
          scrollHistory(liveCard?.querySelector(".kami-history-rows"), "down");
        });
      }
    }

    function patchAllArrows() {
      document
        .querySelectorAll(".kami-overlay-arrow:not([data-history-patched])")
        .forEach(patchArrow);
    }

    patchAllArrows();
    const observerTarget = document.getElementById("results") || document.body;
    new MutationObserver(() => patchAllArrows()).observe(observerTarget, {
      childList: true,
      subtree: true,
    });
    const selectedIDsTarget = document.getElementById("selectedIDs");
    if (selectedIDsTarget)
      new MutationObserver(() => patchAllArrows()).observe(selectedIDsTarget, {
        childList: true,
        subtree: true,
      });

    let pollCount = 0;
    const poll = setInterval(() => {
      patchAllArrows();
      if (++pollCount >= 20) clearInterval(poll);
    }, 200);
  }

  const style = document.createElement("style");
  style.textContent = `
    
  `;
  document.head.appendChild(style);

  // --------------------------------------------------------
  // TRADE HISTORY FILTER
  // --------------------------------------------------------

  let isShowingTradeHistory = false;
  // Saves the full URL search string (e.g. "?listing=true&listing-sort=price")
  // that was active before entering trade history, so we can restore it exactly.
  let _savedSearch = "";

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
    if (typeof window.applyKamiPage !== "function") return;

    const resultsDiv = document.getElementById("results");
    if (!resultsDiv) return;

    const _savedScrollY = window.scrollY;

    // Reset only sort/listing-sort; traits, affinity, min-max, clone stay active
    window.resetAllFilters();

    resultsDiv.textContent = "";

    const traded = getKamisWithTradeTime();

    // Start with traded IDs that exist in the dataset
    let validIds = traded
      .map(({ kamiId }) => kamiId)
      .filter((id) =>
        typeof traitsData !== "undefined" ? traitsData[id] !== undefined : true,
      );

    // Apply clone filter if active
    if (window.isShowingClonesOnly) {
      const cloneIds = window.traitSignatures?.cloneIds;
      if (cloneIds) validIds = validIds.filter((id) => cloneIds.has(id));
    }

    // Apply trait checkboxes
    const selectedTraits = window.getSelectedTraitsFromCheckboxes();
    const hasTraitFilters = Object.keys(selectedTraits).length > 0;
    if (hasTraitFilters) {
      validIds = validIds.filter((id) =>
        window.matchesSelectedTraits(id, selectedTraits),
      );
    }

    // Apply affinity filters
    const bodyAff = window.selectedBodyAffinities;
    const handAff = window.selectedHandAffinities;
    if (bodyAff?.size > 0 || handAff?.size > 0) {
      validIds = validIds.filter((id) => {
        const a = window.affinityData?.[id];
        return (
          a &&
          (bodyAff.size === 0 || bodyAff.has(a.body)) &&
          (handAff.size === 0 || handAff.has(a.hand))
        );
      });
    }

    // Apply stat min/max filters
    if (window.hasActiveStatFilters()) {
      validIds = validIds.filter((id) => window.passesStatMinMaxFilters(id));
    }

    window.setFilteredNFTIds(validIds);

    // Build filter summary buttons the same way other views do
    const filterSummaryHTML = hasTraitFilters
      ? `<div class="filter-summary-buttons-container" style="display:flex;flex-wrap:wrap;gap:5px;margin:10px;">${window.buildTraitSummaryButtonsHTML(selectedTraits)}</div>`
      : "";

    window.appendCountHeader(
      resultsDiv,
      `Trade History: ${validIds.length} sold Kamigotchi${window.getAffinityNotation ? window.getAffinityNotation() : ""}`,
      filterSummaryHTML,
    );

    // Always sync URL with active co-filters + tradehistory=true, even when 0 results.
    if (typeof window.updateURL === "function") window.updateURL(true);

    if (validIds.length === 0) {
      const noResults = document.createElement("div");
      noResults.className = "no-results";
      noResults.textContent = "No trade history found";
      resultsDiv.appendChild(noResults);
      return;
    }

    window.loadMoreNFTs();
    window.setupInfiniteScroll();

    requestAnimationFrame(() => {
      window.applyKamiPage(3);
      window.scrollTo({ top: _savedScrollY, behavior: "instant" });
    });
  }

  // Expose so the updateSelectedTraitsDisplay patch in script.js can call it
  window._filterTradeHistory = filterTradeHistory;

  // Expose so refreshData in script.js can reload market history on demand
  window._reloadTradeHistory = loadHistoryData;

  // Expose so patchInfoOverlays in script.js can keep accountNameMap in sync
  window._reloadAccountNames = loadAccountNames;

  function activateTradeHistory() {
    _savedSearch = window.location.search;
    isShowingTradeHistory = true;
    window.__tradeHistoryActive = true;
    document.getElementById("kami-trade-history-btn")?.classList.add("active");
    // Push the history entry first; filterTradeHistory's updateURL(true) will
    // replaceState on top of it to add any active co-filter params.
    history.pushState({ tradeHistory: true }, "", "?tradehistory=true");
    filterTradeHistory();
  }

  function deactivateTradeHistory(skipRestore) {
    isShowingTradeHistory = false;
    window.__tradeHistoryActive = false;
    document
      .getElementById("kami-trade-history-btn")
      ?.classList.remove("active");
    if (typeof window.applyKamiPage === "function") window.applyKamiPage(0);
    const _savedScrollY = window.scrollY;
    if (!skipRestore) {
      // Start from _savedSearch (preserves listing=true, listing-sort, sort, etc. that were
      // active before trade history) then overlay co-filters from the current URL (clones,
      // traits, affinity, minmax) which filterTradeHistory → updateURL keeps up to date.
      // When _savedSearch is empty (page loaded with ?tradehistory=true directly), default
      // to listing=true so sort/listing-sort buttons land in the listing context, not all-NFTs.
      const baseSearch = _savedSearch || "?listing=true";
      const savedParams = new URLSearchParams(baseSearch);
      const currentParams = new URLSearchParams(window.location.search);
      for (const key of ["clones", "traits", "affinity", "minmax", "ids"]) {
        const val = currentParams.get(key);
        if (val !== null) savedParams.set(key, val);
        else savedParams.delete(key);
      }
      const restoreSearch = savedParams.toString()
        ? `?${savedParams.toString()}`
        : "";
      history.replaceState(null, "", restoreSearch || window.location.pathname);
      if (typeof window.handlePopState === "function") window.handlePopState();
      requestAnimationFrame(() =>
        window.scrollTo({ top: _savedScrollY, behavior: "instant" }),
      );
    } else {
      // No restore — rebuild URL from current filter state (strips tradehistory=true since
      // __tradeHistoryActive is now false so the updateURL patch won't re-add it).
      if (typeof window.updateURL === "function") window.updateURL(true);
      requestAnimationFrame(() =>
        window.scrollTo({ top: _savedScrollY, behavior: "instant" }),
      );
    }
    _savedSearch = "";
  }

  function setupTradeHistoryButton() {
    const btn = document.getElementById("kami-trade-history-btn");
    if (!btn) {
      setTimeout(setupTradeHistoryButton, 300);
      return;
    }

    btn.addEventListener("click", () => {
      if (!isShowingTradeHistory) {
        activateTradeHistory();
      }
      // When already active, clicking the button again does nothing —
      // only other sort/filter buttons can exit history mode.
    });

    // Any sort or listing-sort button click while trade history is active → deactivate first.
    // Trait, affinity, minmax, clone button clicks re-run filterTradeHistory with updated filters.
    document.addEventListener(
      "click",
      (e) => {
        if (!isShowingTradeHistory) return;
        const isSortBtn = e.target.closest(".sort-btn");
        const isListingSortBtn = e.target.closest(
          ".listing-sort-btn:not(#kami-trade-history-btn)",
        );
        const isListingBtn = e.target.closest("#listingFilterBtn");
        if (isSortBtn) {
          // Override _savedSearch so deactivateTradeHistory restores with the clicked
          // sort active, rather than whatever sort was set before trade history was entered.
          const sortValue = isSortBtn.getAttribute("data-sort");
          if (sortValue) {
            const params = new URLSearchParams(_savedSearch);
            params.set("sort", sortValue);
            params.set("listing", "true");
            params.delete("listing-sort");
            _savedSearch = `?${params.toString()}`;
          }
          deactivateTradeHistory();
          return;
        }
        if (isListingSortBtn) {
          // Override _savedSearch so deactivateTradeHistory restores into listing mode
          // with the sort that was just clicked, rather than whatever was active before
          // trade history was entered.
          const listingSortValue =
            isListingSortBtn.getAttribute("listing-data-sort") ?? "recent";
          const params = new URLSearchParams(_savedSearch);
          params.set("listing", "true");
          params.set("listing-sort", listingSortValue);
          _savedSearch = `?${params.toString()}`;
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
        const isCloneBtn = e.target.closest("#cloneFilterBtn");
        const isAffinityBtn = e.target.closest(".affinity-btn");
        const isAffinityToggle = e.target.closest("#affinityFilterToggle");
        const isMinmaxToggle = e.target.closest("#minmaxFilterToggle");
        const isClearBtn = e.target.closest("#clearBtn");
        const isTraitCheckbox = e.target.closest(".trait-checkbox");
        const isStatSlider = e.target.closest(".stat-control-input");
        const isStatToggle = e.target.closest(".toggle-input");
        if (
          isCloneBtn ||
          isAffinityBtn ||
          isAffinityToggle ||
          isMinmaxToggle ||
          isClearBtn ||
          isTraitCheckbox
        ) {
          // Let the original handler fire first (bubble), then re-filter
          setTimeout(() => {
            if (isShowingTradeHistory) filterTradeHistory();
          }, 0);
        }
        // isStatSlider and isStatToggle are handled by triggerStatFilter() in script.js,
        // which now delegates to filterTradeHistory() when trade history is active.
      },
      true,
    ); // capture phase

    // Handle browser back/forward
    window.addEventListener("popstate", () => {
      const params = new URLSearchParams(window.location.search);
      const wantsHistory = params.get("tradehistory") === "true";
      if (wantsHistory && !isShowingTradeHistory) {
        isShowingTradeHistory = true;
        window.__tradeHistoryActive = true;
        document
          .getElementById("kami-trade-history-btn")
          ?.classList.add("active");
        filterTradeHistory();
      } else if (!wantsHistory && isShowingTradeHistory) {
        isShowingTradeHistory = false;
        window.__tradeHistoryActive = false;
        document
          .getElementById("kami-trade-history-btn")
          ?.classList.remove("active");
        if (typeof window.applyKamiPage === "function") window.applyKamiPage(0);
      }
    });

    // If page loaded with ?tradehistory=true in URL, activate immediately —
    // but only once kami data (traitsData etc.) is ready, to avoid a race with loadData().
    if (
      new URLSearchParams(window.location.search).get("tradehistory") === "true"
    ) {
      isShowingTradeHistory = true;
      window.__tradeHistoryActive = true;
      btn.classList.add("active");
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
