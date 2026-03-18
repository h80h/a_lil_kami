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
        console.log('📜 New trades detected — reloading page');
        location.reload();
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

  function getHistoryHTML(id) {
    const records = kamiHistoryMap.get(String(id));

    if (!records || records.length === 0) {
      return `<div class="kami-history"><div class="kami-history-empty">no trades yet</div></div>`;
    }

    const rows = [...records].reverse().map(r => {
      const tradeDate = r.tradeTime ? new Date(r.tradeTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '???';
      const tag    = r.type === 'bid' ? 'offer' : 'sale';
      const seller = resolveAccount(r.seller);
      const buyer  = resolveAccount(r.buyer);
      const isNew = tradeNewWindow[r.orderId] > 0;
      return `<div class="kami-history-row${isNew ? ' kami-history-row-new' : ''}">
        <div class="kami-history-row-top">
          <span class="kami-history-price">Ξ${r.price}</span>
          <span class="kami-history-date">${tradeDate}</span>
          <span class="kami-history-type ${r.type}">${tag}</span>
        </div>
        <div class="kami-history-row-bottom">
          <span class="kami-history-seller">${seller}</span>
          <span class="kami-history-arrow">=></span>
          <span class="kami-history-buyer">${buyer}</span>
        </div>
      </div>`;
    }).join('');

    return `<div class="kami-history" id="kami-history-panel">
      <div class="kami-history-header">${records.length} sale(s)</div>
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
  // INIT
  // --------------------------------------------------------

  Promise.all([loadHistoryData(), loadAccountNames()]).then(() => {
    setInterval(pollMeta, 5 * 60 * 1000);
  });

  patchOverlay();

})();