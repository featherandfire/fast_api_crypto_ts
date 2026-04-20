/* ============================================================
   Crypto Portfolio Tracker — Alpine.js App
   ============================================================ */

const API = '/api';

// ── Utility helpers ──────────────────────────────────────────────────────────

function fmtUSD(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

function fmtPct(n) {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function fmtAmount(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

function _dataScore(c) {
  let s = 0;
  if (c.last != null)       s++;
  if (c.mktCap != null)     s++;
  if (c.vol90d != null)     s++;
  if (c.vol180d != null)    s++;
  if (c.vol365d != null)    s++;
  if (c.high != null)       s++;
  if (c.low != null)        s++;
  if (c.circulating != null) s++;
  if (c.change1_5y != null) s++;
  return s;
}

function fmtMktCap(n) {
  if (n == null) return '—';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(1) + 'M';
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function debounce(fn, ms = 350) {
  let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}

// ── localStorage TTL cache helpers ───────────────────────────────────────────

function lsSet(key, value, ttlSeconds = null) {
  try {
    localStorage.setItem(key, JSON.stringify({
      v:   value,
      exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    }));
  } catch {}
}

function lsGet(key) {
  try {
    const item = JSON.parse(localStorage.getItem(key));
    if (!item) return null;
    if (item.exp && Date.now() > item.exp) { localStorage.removeItem(key); return null; }
    return item.v;
  } catch { return null; }
}

// ── API client ───────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { localStorage.removeItem('token'); window.location.reload(); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const e = new Error(err.detail || 'Request failed');
    e.status = res.status;
    e.headers = res.headers;
    throw e;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Toast store ──────────────────────────────────────────────────────────────

document.addEventListener('alpine:init', () => {
  Alpine.store('toast', {
    items: [],
    show(msg, type = 'success') {
      const id = Date.now();
      this.items.push({ id, msg, type });
      setTimeout(() => { this.items = this.items.filter(i => i.id !== id); }, 3500);
    },
  });

  // ── Auth store ──────────────────────────────────────────────────────────────
  Alpine.store('auth', {
    token: localStorage.getItem('token'),
    user: null,

    // DEV_BYPASS: auth disabled — backend returns a dev user for any request.
    // To re-enable, restore: get isLoggedIn() { return !!this.token; }
    get isLoggedIn() { return true; },

    async init() {
      // DEV_BYPASS: fetch the dev user without a token; ignore errors.
      try { this.user = await apiFetch('/auth/me'); }
      catch { /* auth bypassed — safe to ignore */ }
    },

    async login(username, password) {
      const body = new URLSearchParams({ username, password });
      const res = await fetch(API + '/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const data = await res.json();
      this.token = data.access_token;
      localStorage.setItem('token', this.token);
      this.user = await apiFetch('/auth/me');
    },

    async register(username, email, password) {
      return await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password }),
      });
    },

    logout() {
      this.token = null;
      this.user = null;
      localStorage.removeItem('token');
    },
  });
});

// ── Login component ──────────────────────────────────────────────────────────

function loginApp() {
  return {
    tab: 'login',
    username: '', email: '', password: '',
    loading: false, error: '',

    // verification step
    verifyStep: false,
    pendingEmail: '',
    verifyCode: '',
    resendCooldown: 0,

    async submit() {
      this.error = '';
      this.loading = true;
      try {
        if (this.tab === 'login') {
          await Alpine.store('auth').login(this.username, this.password);
          window.location.reload();
        } else {
          const res = await Alpine.store('auth').register(this.username, this.email, this.password);
          this.pendingEmail = res.email;
          this.verifyStep = true;
        }
      } catch (e) {
        // Login blocked because account unverified
        if (e.message === 'Account not verified') {
          this.pendingEmail = e.headers?.get('X-Verify-Email') || this.email || this.username;
          this.verifyStep = true;
        } else {
          this.error = e.message;
        }
      } finally {
        this.loading = false;
      }
    },

    async submitVerify() {
      this.error = '';
      this.loading = true;
      try {
        const data = await apiFetch('/auth/verify', {
          method: 'POST',
          body: JSON.stringify({ email: this.pendingEmail, code: this.verifyCode.trim() }),
        });
        Alpine.store('auth').token = data.access_token;
        localStorage.setItem('token', data.access_token);
        Alpine.store('auth').user = await apiFetch('/auth/me');
        window.location.reload();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async resendCode() {
      if (this.resendCooldown > 0) return;
      try {
        await apiFetch('/auth/resend', {
          method: 'POST',
          body: JSON.stringify({ email: this.pendingEmail }),
        });
        Alpine.store('toast').show('New code sent — check your email');
        this.resendCooldown = 60;
        const t = setInterval(() => {
          this.resendCooldown--;
          if (this.resendCooldown <= 0) clearInterval(t);
        }, 1000);
      } catch (e) {
        Alpine.store('toast').show(e.message, 'error');
      }
    },
  };
}

// ── Main dashboard app ───────────────────────────────────────────────────────

function dashApp() {
  return {
    page: 'dashboard',
    portfolios: [],
    activePortfolioId: null,
    portfolioDetail: null,
    lastBuyFees: {},          // holdingId -> 'loading' | 'unavailable' | { router, fee_display, fee_sol }
    activeWalletFilter: null, // when set, the holdings table shows only this wallet's rows
    loadingPortfolio: false,
    _refreshTimer: null,

    // Market page
    topCoins: [],
    filteredCoins: [],
    loadingMarket: false,
    coinSearch: '',
    priceChart: null,
    selectedChartCoin: null,

    // Add portfolio modal
    showAddPortfolio: false,
    newPortfolioName: '',

    // Add holding modal
    showAddHolding: false,
    holdingModalTab: 'search',
    holdingDropdownOpen: false,
    holdingSearch: '',
    holdingSearchResults: [],
    holdingDisplayCoins: [],
    holdingSearchLoading: false,
    selectedCoin: null,
    holdingAmount: '',
    holdingAvgPrice: '',
    addingHolding: false,

    // Wallet import — auto-probes all supported EVM chains + Solana in one shot
    walletAddress: '',
    txHash: '',
    txResolving: false,
    txResolveInfo: '',
    txResolveError: '',
    walletTokens: [],
    walletLoading: false,
    walletError: '',
    walletImporting: false,

    // Charts
    pieChart: null,
    lineChart: null,

    // Hash Lookup
    lookupQuery: '',
    lookupLoading: false,
    lookupResult: null,
    lookupError: '',

    // Marketplace
    marketplaceCoins: [],
    marketplaceLoading: false,
    marketplaceError: '',
    _marketplaceCache: {},
    mkPage: 1,
    mkPerPage: 50,
    mkSearch: '',
    mkSort: 'price_desc',
    mkPinned: null,

    async init() {
      await Alpine.store('auth').init();
      if (!Alpine.store('auth').isLoggedIn) return;
      await this.loadPortfolios();
      if (this.portfolios.length) {
        this.activePortfolioId = this.portfolios[0].id;
        await this.loadPortfolioDetail();
      }
      this.$watch('page', (p) => {
        if (p === 'market') this.loadMarket();
        if (p === 'marketplace') this.loadMarketplace();
      });

      // Auto-refresh portfolio prices every 60 seconds
      this._refreshTimer = setInterval(async () => {
        if (this.activePortfolioId && !this.loadingPortfolio) {
          try {
            this.portfolioDetail = await apiFetch(`/portfolios/${this.activePortfolioId}`);
            this.renderPieChart();
          } catch {}
        }
      }, 90_000);
      // pre-fetch coins for ticker strip — always use limit=200 as canonical set
      setTimeout(() => {
        if (this.topCoins.length < 200) {
          apiFetch('/coins/top?limit=200').then(c => { if (c) this.topCoins = c; }).catch(() => {});
        }
      }, 2000);
      this.$watch('holdingSearch', () => this._rebuildHoldingCoins());
      this.$watch('holdingSearchResults', () => this._rebuildHoldingCoins());
      this.$watch('topCoins', () => { this._rebuildHoldingCoins(); this._rebuildFilteredCoins(); });
      this.$watch('coinSearch', () => this._rebuildFilteredCoins());
    },

    // ── Portfolio ────────────────────────────────────────────────────────────

    async loadPortfolios() {
      this.portfolios = await apiFetch('/portfolios');
    },

    async selectPortfolio(id) {
      this.activePortfolioId = id;
      await this.loadPortfolioDetail();
    },

    async loadPortfolioDetail() {
      if (!this.activePortfolioId) return;
      this.loadingPortfolio = true;
      this.activeWalletFilter = null;  // reset filter when the portfolio reloads
      try {
        this.portfolioDetail = await apiFetch(`/portfolios/${this.activePortfolioId}`);
        await this.$nextTick();
        this.renderPieChart();
        this.loadLastBuyFees();
      } catch (e) {
        Alpine.store('toast').show(e.message, 'error');
      } finally {
        this.loadingPortfolio = false;
      }
    },

    // For each holding, fetch the last-buy fee breakdown on the correct
    // chain (EVM via Etherscan, Solana via RPC). Holdings without a wallet
    // or unknown address format are marked unavailable.
    async loadLastBuyFees() {
      const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
      const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
      const holdings = this.portfolioDetail?.holdings ?? [];
      const nextState = {};
      const jobs = [];
      for (const h of holdings) {
        const addr = h.wallet_address ?? '';
        let url = null;
        if (EVM_RE.test(addr)) {
          // Default to Ethereum; if the import tagged the holding with a
          // different chain later, the url can be parameterized.
          url = `/wallet/eth/${encodeURIComponent(addr)}/last-buy-fees?coingecko_id=${encodeURIComponent(h.coin.coingecko_id)}`;
        } else if (SOL_RE.test(addr)) {
          url = `/wallet/solana/${encodeURIComponent(addr)}/last-buy-fees?coingecko_id=${encodeURIComponent(h.coin.coingecko_id)}`;
        }
        if (url) {
          nextState[h.id] = 'loading';
          jobs.push({ id: h.id, url });
        } else {
          nextState[h.id] = 'unavailable';
        }
      }
      this.lastBuyFees = nextState;

      for (const job of jobs) {
        try {
          const fees = await apiFetch(job.url);
          this.lastBuyFees = { ...this.lastBuyFees, [job.id]: fees };
        } catch {
          this.lastBuyFees = { ...this.lastBuyFees, [job.id]: 'unavailable' };
        }
      }
    },

    async createPortfolio() {
      if (!this.newPortfolioName.trim()) return;
      try {
        const p = await apiFetch('/portfolios', {
          method: 'POST',
          body: JSON.stringify({ name: this.newPortfolioName }),
        });
        this.portfolios.push(p);
        this.activePortfolioId = p.id;
        await this.loadPortfolioDetail();
        this.showAddPortfolio = false;
        this.newPortfolioName = '';
        Alpine.store('toast').show('Portfolio created');
      } catch (e) {
        Alpine.store('toast').show(e.message, 'error');
      }
    },

    async deletePortfolio(id) {
      if (!confirm('Delete this portfolio and all its holdings?')) return;
      try {
        await apiFetch(`/portfolios/${id}`, { method: 'DELETE' });
        this.portfolios = this.portfolios.filter(p => p.id !== id);
        if (this.activePortfolioId === id) {
          this.activePortfolioId = this.portfolios[0]?.id || null;
          this.portfolioDetail = null;
          if (this.activePortfolioId) await this.loadPortfolioDetail();
        }
        Alpine.store('toast').show('Portfolio deleted');
      } catch (e) {
        Alpine.store('toast').show(e.message, 'error');
      }
    },

    // ── Holdings ─────────────────────────────────────────────────────────────

    async openAddHolding() {
      this._resetHoldingModal();
      this.showAddHolding = true;
      if (this.topCoins.length < 200) {
        try { this.topCoins = await apiFetch('/coins/top?limit=200'); } catch {}
      }
      this._rebuildHoldingCoins();
    },

    closeAddHolding() {
      this.showAddHolding = false;
      this._resetHoldingModal();
    },

    _resetHoldingModal() {
      this.holdingModalTab = 'search';
      this.holdingSearch = '';
      this.holdingSearchResults = [];
      this.selectedCoin = null;
      this.holdingAmount = '';
      this.holdingAvgPrice = '';
      this.holdingDropdownOpen = false;
      this.walletAddress = '';
      this.walletTokens = [];
      this.walletError = '';
      this.txHash = '';
      this.txResolveInfo = '';
      this.txResolveError = '';
    },

    async resolveWalletFromTx() {
      const hash = this.txHash.trim();
      if (!hash) return;
      this.txResolving = true;
      this.txResolveInfo = '';
      this.txResolveError = '';
      try {
        const info = await apiFetch(`/wallet/from-tx/${encodeURIComponent(hash)}`);
        this.walletAddress = info.address;
        this.txResolveInfo = `Found wallet on ${info.chain_name} — ready to fetch below.`;
      } catch (e) {
        this.txResolveError = e.message;
      } finally {
        this.txResolving = false;
      }
    },

    async fetchWalletTokens() {
      const addr = this.walletAddress.trim();
      if (!addr) return;
      this.walletLoading = true;
      this.walletError = '';
      this.walletTokens = [];
      try {
        const tokens = await apiFetch(`/wallet/all/${encodeURIComponent(addr)}`);
        this.walletTokens = tokens.map(t => ({ ...t, selected: t.matched }));
      } catch (e) {
        this.walletError = e.message;
      } finally {
        this.walletLoading = false;
      }
    },

    async importSelectedWalletTokens() {
      const toImport = this.walletTokens.filter(t => t.selected);
      if (!toImport.length) return;
      this.walletImporting = true;
      // EVM (0x…) is case-insensitive — lowercase for consistency.
      // Solana base58 is case-sensitive — preserve as-is.
      const raw = this.walletAddress.trim();
      const walletAddr = /^0x[0-9a-fA-F]+$/.test(raw) ? raw.toLowerCase() : raw;
      let successCount = 0;
      let dupCount = 0;
      for (const token of toImport) {
        // Matched: use CoinGecko slug. Unmatched: fall back to the contract
        // address as the coin id and pass along the on-chain symbol/name so
        // the backend can create a "manual" coin entry (no price data).
        const coingeckoId = token.matched ? token.coingecko_id : token.contract_address;
        const body = {
          coingecko_id: coingeckoId,
          amount: token.amount,
          avg_buy_price: null,
          wallet_address: walletAddr,
          contract_address: token.contract_address,
        };
        if (!token.matched) {
          body.symbol = token.symbol;
          body.name = token.name;
          body.image_url = token.image_url;
        }
        try {
          await apiFetch(`/portfolios/${this.activePortfolioId}/holdings`, {
            method: 'POST',
            body: JSON.stringify(body),
          });
          successCount++;
        } catch (e) {
          if (e.message.includes('already in portfolio')) {
            dupCount++;
          } else {
            Alpine.store('toast').show(`Skipped ${token.symbol}: ${e.message}`, 'error');
          }
        }
      }
      this.walletImporting = false;
      if (successCount > 0) {
        await this.loadPortfolioDetail();
        this.closeAddHolding();
        const msg = dupCount > 0
          ? `Imported ${successCount} new holding${successCount > 1 ? 's' : ''} — skipped ${dupCount} already in portfolio`
          : `Imported ${successCount} holding${successCount > 1 ? 's' : ''}`;
        Alpine.store('toast').show(msg);
      } else if (dupCount > 0) {
        // Nothing new imported — every selected token was already in the portfolio
        // for this wallet. Surface that clearly rather than silently closing.
        this.closeAddHolding();
        Alpine.store('toast').show('This wallet is already in your portfolio', 'error');
      }
    },

    _rebuildHoldingCoins() {
      const q = this.holdingSearch.toLowerCase().trim();
      const top = this.topCoins.map(c => ({
        id: c.coingecko_id,
        name: c.name,
        symbol: c.symbol,
        thumb: c.image_url,
      }));
      const filtered = q
        ? top.filter(c => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q))
        : top;
      const ids = new Set(filtered.map(c => c.id));
      const extra = this.holdingSearchResults.filter(c => !ids.has(c.id));
      this.holdingDisplayCoins = [...filtered, ...extra];
    },

    searchHoldingCoins: debounce(async function(q) {
      // If user edits after picking a coin, invalidate the selection
      if (this.selectedCoin && q !== this.selectedCoin.name) this.selectedCoin = null;
      if (q.length < 2) { this.holdingSearchResults = []; return; }
      this.holdingSearchLoading = true;
      try {
        this.holdingSearchResults = await apiFetch(`/coins/search?q=${encodeURIComponent(q)}`);
      } finally {
        this.holdingSearchLoading = false;
      }
    }),

    selectHoldingCoin(coin) {
      this.selectedCoin = coin;
      this.holdingSearch = coin.name;
      this.holdingSearchResults = [];
      this.holdingDropdownOpen = false;
    },

    async addHolding() {
      if (!this.selectedCoin || !this.holdingAmount) return;
      this.addingHolding = true;
      try {
        await apiFetch(`/portfolios/${this.activePortfolioId}/holdings`, {
          method: 'POST',
          body: JSON.stringify({
            coingecko_id: this.selectedCoin.id,
            amount: parseFloat(this.holdingAmount),
            avg_buy_price: this.holdingAvgPrice ? parseFloat(this.holdingAvgPrice) : null,
          }),
        });
        await this.loadPortfolioDetail();
        this.closeAddHolding();
        Alpine.store('toast').show('Holding added');
      } catch (e) {
        Alpine.store('toast').show(e.message, 'error');
      } finally {
        this.addingHolding = false;
      }
    },

    async removeHolding(holdingId) {
      if (!confirm('Remove this holding?')) return;
      try {
        await apiFetch(`/portfolios/${this.activePortfolioId}/holdings/${holdingId}`, { method: 'DELETE' });
        await this.loadPortfolioDetail();
        Alpine.store('toast').show('Holding removed');
      } catch (e) {
        Alpine.store('toast').show(e.message, 'error');
      }
    },

    // ── Charts ───────────────────────────────────────────────────────────────

    renderPieChart() {
      const canvas = document.getElementById('pieChart');
      if (!canvas || !this.portfolioDetail?.holdings?.length) return;
      if (getComputedStyle(canvas).display === 'none') return;

      if (this.pieChart) this.pieChart.destroy();

      const holdings = this.portfolioDetail.holdings.filter(h => h.current_value_usd > 0);
      const labels = holdings.map(h => h.coin.name);
      const data = holdings.map(h => h.current_value_usd);
      const colors = [
        '#b44dff','#00e676','#ff3366','#cc77ff','#00bcd4',
        '#7c3aed','#39ff14','#ff6ec7','#a78bfa','#0ff',
      ];

      this.pieChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: colors.slice(0, data.length).map(c => c + 'cc'), // slight transparency
            borderColor: colors.slice(0, data.length),
            borderWidth: 2,
            hoverOffset: 10,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { color: '#5c5280', boxWidth: 10, padding: 14, font: { size: 11, family: "'JetBrains Mono', monospace" } },
            },
            tooltip: {
              backgroundColor: '#0d0a1e',
              borderColor: '#261d4a',
              borderWidth: 1,
              titleColor: '#e8e0ff',
              bodyColor: '#b44dff',
              callbacks: {
                label: ctx => ` ${fmtUSD(ctx.raw)} (${(ctx.raw / ctx.dataset.data.reduce((a,b)=>a+b,0)*100).toFixed(1)}%)`,
              },
            },
          },
        },
      });
    },

    async renderPriceChart(coingeckoId, days = 30) {
      this.selectedChartCoin = coingeckoId;
      const canvas = document.getElementById('lineChart');
      if (!canvas) return;

      if (this.lineChart) this.lineChart.destroy();

      try {
        const data = await apiFetch(`/coins/${coingeckoId}/history?days=${days}`);
        const labels = data.prices.map(p => new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        const prices = data.prices.map(p => p.price);

        this.lineChart = new Chart(canvas, {
          type: 'line',
          data: {
            labels,
            datasets: [{
              label: coingeckoId.toUpperCase(),
              data: prices,
              borderColor: '#b44dff',
              backgroundColor: 'rgba(180,77,255,0.08)',
              borderWidth: 2,
              pointRadius: 0,
              fill: true,
              tension: 0.3,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
              x: {
                ticks: { color: '#5c5280', maxTicksLimit: 8, font: { size: 11 } },
                grid: { color: '#261d4a' },
              },
              y: {
                ticks: {
                  color: '#5c5280', font: { size: 11 },
                  callback: v => fmtUSD(v),
                },
                grid: { color: '#261d4a' },
              },
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => ` ${fmtUSD(ctx.raw)}`,
                },
              },
            },
          },
        });
      } catch (e) {
        const msg = e?.detail || e?.message || 'Failed to load price chart';
        Alpine.store('toast').show(msg, 'error');
      }
    },

    // ── Market ───────────────────────────────────────────────────────────────

    async loadMarket() {
      this.loadingMarket = true;
      try {
        if (this.topCoins.length < 200) {
          this.topCoins = await apiFetch('/coins/top?limit=200');
        }
      } catch (e) {
        Alpine.store('toast').show(e.message, 'error');
      } finally {
        this.loadingMarket = false;
      }
    },

    _rebuildFilteredCoins() {
      const q = this.coinSearch.toLowerCase();
      this.filteredCoins = q
        ? this.topCoins.filter(c => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q))
        : [...this.topCoins];
    },

    // ── Helpers ──────────────────────────────────────────────────────────────

    async lookupHash() {
      const q = this.lookupQuery.trim();
      if (!q) return;
      this.lookupLoading = true;
      this.lookupError = '';
      this.lookupResult = null;
      try {
        this.lookupResult = await apiFetch(`/lookup/${encodeURIComponent(q)}`);
      } catch (e) {
        this.lookupError = e.message;
      } finally {
        this.lookupLoading = false;
      }
    },

    paxosCoinDescription(symbol) { return COIN_DESCRIPTIONS[symbol.toUpperCase()] || null; },

    // Current portfolio's holdings, narrowed to the active wallet filter
    // when one is set (clicking a wallet chip above the table).
    filteredHoldings() {
      const all = this.portfolioDetail?.holdings ?? [];
      if (!this.activeWalletFilter) return all;
      return all.filter((h) => h.wallet_address === this.activeWalletFilter);
    },

    // Unique list of wallet addresses across the current portfolio's holdings.
    portfolioWallets() {
      const holdings = this.portfolioDetail?.holdings ?? [];
      const seen = new Set();
      const out = [];
      for (const h of holdings) {
        if (h.wallet_address && !seen.has(h.wallet_address)) {
          seen.add(h.wallet_address);
          out.push(h.wallet_address);
        }
      }
      return out;
    },

    walletIsSolana(addr) {
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr ?? '');
    },

    // Deterministic 0..5 from any string — used to pick a placeholder shape
    // for unknown-icon coins. Same input always yields the same shape, so a
    // given coin looks consistent across renders.
    unknownCoinShape(key) {
      if (!key) return 0;
      let h = 0;
      for (let i = 0; i < key.length; i++) {
        h = ((h << 5) - h + key.charCodeAt(i)) | 0;
      }
      return Math.abs(h) % 6;
    },

    // Categorize detected router names into the three roles that actually
    // matter end-to-end: who fronted the UX (Platform), who found the route
    // (DEX Routing), and which pool filled the order (Liquidity Pool).
    categorizeRouters(routers) {
      const PLATFORM = new Set(['Phantom Swap']);
      const ROUTING  = new Set(['Jupiter', 'Jupiter v3', 'Jupiter v4', 'OKX DEX', 'OKX DEX Aggregator', 'OKX Labs', 'Dex.guru']);
      const out = { platform: null, dex_routing: null, liquidity_pool: null };
      for (const r of (routers ?? [])) {
        if (PLATFORM.has(r) && !out.platform) out.platform = r;
        else if (ROUTING.has(r) && !out.dex_routing) out.dex_routing = r;
        else if (!out.liquidity_pool) out.liquidity_pool = r;
      }
      return out;
    },

    // Combine fee-party amounts into a single display string. Stablecoin-
    // denominated fees collapse to "$X.XX"; non-stable fees keep token units.
    totalFeeLabel(parties) {
      if (!parties || !parties.length) return '';
      const stableTotal = parties.filter(p => p.is_stable).reduce((s, p) => s + p.amount, 0);
      const byMint = {};
      for (const p of parties.filter(p => !p.is_stable)) {
        byMint[p.mint] = byMint[p.mint] || { amount: 0, symbol: p.symbol };
        byMint[p.mint].amount += p.amount;
      }
      const parts = [];
      if (stableTotal > 0) parts.push('$' + stableTotal.toFixed(2));
      for (const { amount, symbol } of Object.values(byMint)) {
        parts.push(fmtAmount(amount) + ' ' + symbol);
      }
      return parts.join(' + ');
    },

    coinCollateral(symbol) { return _collateralMap[symbol.toUpperCase()] || null; },

    volatilityLabel(vol) {
      if (vol == null) return null;
      if (vol < 0.20) return { label: 'Low',       cls: 'badge-green'  };
      if (vol < 0.55) return { label: 'Moderate',   cls: 'badge-yellow' };
      if (vol < 0.85) return { label: 'High',       cls: 'badge-orange'  };
      return              { label: 'Very High',  cls: 'badge-red-glow' };
    },

    coinFeatures(symbol) { return COIN_FEATURES[symbol.toUpperCase()] || null; },

    coinYieldTypes(symbol) { return COIN_YIELD_TYPES[symbol.toUpperCase()] || null; },


    // ── Marketplace ───────────────────────────────────────────────────────────

    async loadMarketplace() {
      if (this.marketplaceLoading) return;
      this.marketplaceLoading = true;
      this.marketplaceError = '';
      try {
        // Reuse shared caches
        let iconCache      = lsGet('icon_cache')  || {};
        let yearlyCache    = lsGet('yearly_cache')   || {};
        let longRangeCache = lsGet('long_range_cache')     || {};

        // Ensure topCoins are loaded
        if (this.topCoins.length < 200) {
          try { this.topCoins = await apiFetch('/coins/top?limit=200'); } catch {}
        }

        const cgBySymbol = {};
        for (const c of this.topCoins) cgBySymbol[c.symbol.toUpperCase()] = c;

        // All top coins — comprehensive market view
        const coins = this.topCoins
          .map(c => {
            const sym = c.symbol.toUpperCase();
            const yearly = yearlyCache[c.coingecko_id] || {};
            const lr     = longRangeCache[sym] || {};

            // Keep icon cache warm
            if (c.image_url) iconCache[sym] = { url: c.image_url, name: c.name };

            const fresh = {
              image:       c.image_url ?? iconCache[sym]?.url ?? null,
              coinName:    c.name ?? iconCache[sym]?.name ?? null,
              mktCap:      c.market_cap ?? null,
              base_asset:  sym,
              market:      sym + '/USD',
              change200d:  c.price_change_200d ?? null,
              change1y:    c.price_change_1y   ?? null,
              change1_5y:  lr.change1_5y ?? null,
              vol90d:      yearly.vol_90d  ?? null,
              vol180d:     yearly.vol_180d ?? null,
              vol365d:     yearly.vol_365d ?? null,
              last:        c.current_price_usd  ?? null,
              bid:         null,
              ask:         null,
              spread:      null,
              high:        yearly.high_1y ?? null,
              low:         yearly.low_1y  ?? null,
              circulating: c.circulating_supply ?? null,
              hardCap:     HARD_CAPS[sym] !== undefined ? HARD_CAPS[sym] : (c.max_supply ?? null),
            };
            const cached = this._marketplaceCache[sym] || {};
            const merged = {};
            for (const key of Object.keys(fresh)) merged[key] = fresh[key] ?? cached[key] ?? null;
            this._marketplaceCache[sym] = { ...cached, ...merged };
            return { ...merged };
          })
          .sort((a, b) => {
            const scoreA = _dataScore(a);
            const scoreB = _dataScore(b);
            if (scoreB !== scoreA) return scoreB - scoreA;
            return (b.last || 0) - (a.last || 0);
          });

        lsSet('icon_cache', iconCache, null);
        this.marketplaceCoins = coins;

        // Background-fetch 1Y ranges for uncached coins
        const mkIds = coins
          .map(c => cgBySymbol[c.base_asset]?.coingecko_id)
          .filter(id => id && !yearlyCache[id]);
        if (mkIds.length) {
          apiFetch(`/coins/yearly-ranges?ids=${mkIds.join(',')}`).then(fresh => {
            if (!fresh || !Object.keys(fresh).length) return;
            yearlyCache = { ...yearlyCache, ...fresh };
            lsSet('yearly_cache', yearlyCache, 24 * 3600);
            this.marketplaceCoins = this.marketplaceCoins.map(p => {
              const cg = cgBySymbol[p.base_asset];
              const yr = fresh[cg?.coingecko_id];
              if (!yr) return p;
              const updated = { ...p, high: yr.high_1y ?? p.high, low: yr.low_1y ?? p.low, vol90d: yr.vol_90d ?? p.vol90d, vol180d: yr.vol_180d ?? p.vol180d, vol365d: yr.vol_365d ?? p.vol365d };
              this._marketplaceCache[p.base_asset] = { ...this._marketplaceCache[p.base_asset], ...updated };
              return updated;
            }).sort((a, b) => {
              const sa = _dataScore(a), sb = _dataScore(b);
              if (sb !== sa) return sb - sa;
              return (b.last || 0) - (a.last || 0);
            });
          }).catch(() => {});
        }

        // Fetch 1.5Y & 3Y changes from CryptoCompare (served from server cache)
        const mkSymsForLR = coins
          .map(c => c.base_asset)
          .filter(s => !longRangeCache[s]);
        if (mkSymsForLR.length) {
          apiFetch(`/cryptocompare/changes?symbols=${mkSymsForLR.join(',')}&days=548`).then(fresh => {
            if (!fresh || !Object.keys(fresh).length) return;
            for (const [sym, data] of Object.entries(fresh)) {
              longRangeCache[sym] = { change1_5y: data[548] ?? null };
            }
            lsSet('long_range_cache', longRangeCache, 24 * 3600);
            this.marketplaceCoins = this.marketplaceCoins.map(p => {
              const lr = longRangeCache[p.base_asset];
              if (!lr) return p;
              const updated = { ...p, change1_5y: lr.change1_5y ?? p.change1_5y };
              this._marketplaceCache[p.base_asset] = { ...this._marketplaceCache[p.base_asset], ...updated };
              return updated;
            }).sort((a, b) => {
              const sa = _dataScore(a), sb = _dataScore(b);
              if (sb !== sa) return sb - sa;
              return (b.last || 0) - (a.last || 0);
            });
          }).catch(() => {});
        }

      } catch (e) {
        this.marketplaceError = e.message;
      } finally {
        this.marketplaceLoading = false;
        this.mkPage = 1;
      }
    },

    mkFilteredCoins() {
      const STABLES = STABLECOIN_SYMBOLS;
      let coins = this.marketplaceCoins;

      // Text search
      if (this.mkSearch.trim()) {
        const q = this.mkSearch.trim().toLowerCase();
        coins = coins.filter(c =>
          c.base_asset.toLowerCase().includes(q) ||
          (c.coinName || '').toLowerCase().includes(q)
        );
      }

      // Sort/filter by dropdown
      switch (this.mkSort) {
        case 'price_asc':
          coins = [...coins]
            .filter(c => c.last != null)
            .sort((a, b) => a.last - b.last);
          break;
        case 'vol_desc':
          coins = [...coins].sort((a, b) => (b.vol90d || 0) - (a.vol90d || 0));
          break;
        case 'vol_asc':
          coins = [...coins].sort((a, b) => (a.vol90d ?? Infinity) - (b.vol90d ?? Infinity));
          break;
        case 'stablecoin':
          coins = coins.filter(c => STABLES.has(c.base_asset));
          break;
        case 'income_yield':
          // Coins with no parseable APR fall to the bottom.
          coins = [...coins].sort((a, b) => (coinYieldApr(b.base_asset) ?? -1) - (coinYieldApr(a.base_asset) ?? -1));
          break;
        default: // price_desc
          coins = [...coins].sort((a, b) => {
            const sa = _dataScore(a), sb = _dataScore(b);
            if (sb !== sa) return sb - sa;
            return (b.last || 0) - (a.last || 0);
          });
          break;
      }

      // Float pinned coin to top
      if (this.mkPinned) {
        const idx = coins.findIndex(c => c.base_asset === this.mkPinned);
        if (idx > 0) {
          const [pinned] = coins.splice(idx, 1);
          coins.unshift(pinned);
        }
      }

      return coins;
    },

    mkPageCoins() {
      const filtered = this.mkFilteredCoins();
      const start = (this.mkPage - 1) * this.mkPerPage;
      return filtered.slice(start, start + this.mkPerPage);
    },

    mkTotalPages() {
      return Math.max(1, Math.ceil(this.mkFilteredCoins().length / this.mkPerPage));
    },

    fmtPaxosPrice(v) {
      if (v == null) return '—';
      const n = parseFloat(v);
      if (isNaN(n) || n === 0) return '—';
      if (n < 0.0001)  return '$' + n.toFixed(10).replace(/\.?0+$/, '');
      if (n < 0.01)    return '$' + n.toFixed(6).replace(/\.?0+$/, '');
      if (n < 1)       return '$' + n.toFixed(4);
      return fmtUSD(n);
    },

    lookupConfidenceClass(c) {
      if (c === 'confirmed') return 'badge-green';
      if (c === 'likely')    return 'badge-yellow';
      return 'badge-muted';
    },

    lookupConfidenceLabel(c) {
      if (c === 'confirmed') return 'Confirmed';
      if (c === 'likely')    return 'Likely';
      return 'Format Match';
    },

    fmtUSD, fmtPct, fmtAmount,

    pnlClass(n) { return n == null ? '' : n >= 0 ? 'pos' : 'neg'; },

    logout() {
      clearInterval(this._refreshTimer);
      Alpine.store('auth').logout();
      window.location.reload();
    },
  };
}
