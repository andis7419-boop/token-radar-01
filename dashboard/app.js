/* Token Radar — dashboard logic (model radar-2).
   Static page, no network: reads window.RADAR from data.js, renders the board,
   the detail view, the live-token calibration view and the model explainer.
   Farm plans are generated here from each row's own category, chain, size and
   age (see buildFarmSteps); board.json carries the same six steps per row. */
(function () {
  "use strict";

  var D = window.RADAR || null;
  var boardEl = document.getElementById("board-body");
  var detailEl = document.getElementById("detail");

  /* ---------- small helpers ---------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(v, dflt) { return typeof v === "number" && isFinite(v) ? v : dflt; }
  function money(v) {
    v = num(v, 0);
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + Math.round(v);
  }
  function moneyFull(v) { /* exact dollars for the model breakdown */
    v = num(v, 0);
    return "$" + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  /* change_7d / growth_pct arrive as percent points (e.g. -8.9 = -8.9% in 7d),
     exactly as the snapshot stores them; the starter model clamps them as such. */
  function pct(v) {
    var p = num(v, 0);
    return (p > 0 ? "+" : "") + p.toFixed(1) + "%";
  }
  function ageText(days) {
    days = num(days, null);
    if (days == null) return "unknown";
    if (days >= 365) return (days / 365).toFixed(1) + "y";
    return days + "d";
  }
  function chainsText(chains) {
    if (!chains || !chains.length) return "—";
    return chains.slice(0, 3).join(", ") + (chains.length > 3 ? " +" + (chains.length - 3) : "");
  }

  /* ---------- farm plans: generated from the row, never hand-listed ---------- */

  /* One template per category: what the qualifying on-chain action is. */
  var CATEGORY_ACTIONS = {
    "Lending":           { verb: "Supply",            noun: "lending action",      detail: "lend stablecoins, keep the loan healthy and the collateral ratio above the liquidation line" },
    "Dexs":              { verb: "Provide liquidity", noun: "liquidity provision", detail: "add a two-sided position to the highest-volume pool and keep it in range" },
    "Yield":             { verb: "Deposit",           noun: "vault deposit",       detail: "deposit into the highest-TVL vault and leave auto-compounding on" },
    "Yield Aggregator":  { verb: "Deposit",           noun: "vault deposit",       detail: "deposit into the highest-TVL vault and leave auto-compounding on" },
    "Derivatives":       { verb: "Open a position",   noun: "derivatives trade",   detail: "open a small margined position and keep it hedged so it survives volatility" },
    "CDP":               { verb: "Mint",              noun: "minting action",      detail: "lock collateral and mint the protocol stablecoin, staying well above the minimum ratio" },
    "RWA":               { verb: "Mint or buy",       noun: "tokenised-asset hold", detail: "mint or buy the tokenised asset and hold it in the fresh wallet" },
    "Bridge":            { verb: "Bridge",            noun: "bridging action",     detail: "bridge assets across the chains the protocol serves, in both directions over time" },
    "Restaking":         { verb: "Restake",           noun: "restaking action",    detail: "restake liquid-staking tokens through the protocol and keep the receipt token" },
    "Liquid Staking":    { verb: "Stake",             noun: "staking action",      detail: "stake through the protocol and hold the receipt token in the fresh wallet" },
    "Insurance":         { verb: "Provide cover",     noun: "cover underwriting",  detail: "underwrite cover in the protocol pool and keep the stake locked" },
    "Options":           { verb: "Sell options",      noun: "options trade",       detail: "write covered options on the main market and manage the position weekly" },
    "Prediction Market": { verb: "Place a trade",     noun: "prediction trade",    detail: "take positions on the live markets the protocol lists" },
    "Leveraged Farming": { verb: "Open a leveraged farm", noun: "leveraged position", detail: "open a leveraged farming position at the minimum tier and watch the health factor" },
    "Algo-Stables":      { verb: "Mint",              noun: "minting action",      detail: "mint the algorithmic stablecoin against collateral and keep the peg position" },
    "Indexes":           { verb: "Buy the index",     noun: "index holding",       detail: "buy the index token and hold it in the fresh wallet" },
    "Payments":          { verb: "Route a payment",   noun: "payment",             detail: "route a real payment through the protocol from the fresh wallet" },
    "NFT Lending":       { verb: "Supply",            noun: "lending action",      detail: "supply assets to the NFT-backed lending pool" },
    "Farm":              { verb: "Provide liquidity", noun: "farm position",       detail: "add liquidity to the main farm pool and stake the LP tokens" }
  };
  var DEFAULT_ACTION = { verb: "Use", noun: "on-chain action", detail: "use the protocol's core feature with the capital tier below" };

  /* Capital tier follows the protocol's size: bigger protocol, bigger position. */
  function capitalTier(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }
  /* Hold period follows how long the protocol has run with no token. */
  function holdDays(age) {
    if (age == null) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function farmAction(row) {
    return CATEGORY_ACTIONS[row.category] || DEFAULT_ACTION;
  }
  /* The six steps, in the same structure for every protocol. Each step states
     its cost and its time, so a farmer knows the commitment up front. */
  function buildFarmSteps(row) {
    var name = row.name || row.slug || "the protocol";
    var chain = (row.chains && row.chains[0]) || "its main chain";
    var capital = capitalTier(num(row.tvl_usd, 0));
    var hold = holdDays(num(row.age_days, null));
    var act = farmAction(row);
    return [
      "Create a fresh wallet for " + name + " only — new seed phrase written offline, never reused for another airdrop. Cost: $0. Time: 15 min.",
      act.verb + " $" + capital + " on " + name + " (" + chain + "): " + act.detail + ". Cost: $" + capital + " + about $3 gas. Time: 30 min.",
      "Repeat one qualifying " + act.noun + " every week on " + name + " so the position stays active across snapshots. Cost: about $2 gas per week. Time: 10 min per week.",
      "Hold the position for at least " + hold + " days — do not withdraw early, snapshots reward staying power. Cost: $0. Time: " + hold + " days.",
      "Check " + name + "'s own points or rewards page weekly; never pay to claim and never connect through a lookalike link. Cost: $0. Time: 5 min per week.",
      "Keep a farm log: wallet address, dates, amounts and transaction hashes for every action on " + name + ". Cost: $0. Time: 5 min per action."
    ];
  }
  /* Prefer the steps board.json ships (they are the audited copy); generate
     from the row when a row arrives without them. */
  function farmStepsFor(row) {
    if (row.farm_steps && row.farm_steps.length >= 3) return row.farm_steps;
    return buildFarmSteps(row);
  }

  /* ---------- state: filters + sort, seeded from the URL ---------- */

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get("q") || "",
    category: params.get("category") || "",
    chain: params.get("chain") || "",
    watchlist: params.get("watchlist") === "1",
    sort: params.get("sort") || "rank",
    detail: params.get("detail") || ""
  };
  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.category) p.set("category", state.category);
    if (state.chain) p.set("chain", state.chain);
    if (state.watchlist) p.set("watchlist", "1");
    if (state.sort && state.sort !== "rank") p.set("sort", state.sort);
    if (state.detail) p.set("detail", state.detail);
    var qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : window.location.pathname);
  }

  /* ---------- derived data ---------- */

  var rows = (D && D.rows) || [];
  var live = (D && D.live) || [];
  var floor = num(D && D.floor_usd, 50000000);
  /* The snapshot's watchlist is the ground truth: it also excludes wrapped /
     parent-protocol entries the 10 snapshot fields cannot see (e.g. a curator
     whose parent already trades), so TVL alone over-counts it — 60 board rows
     sit at/above the $50M floor, but only 40 slugs are on the watchlist.
     Prefer the slug list when data.js carries it (D.watchlist), then a
     per-row flag, and fall back to the floor only when neither is present. */
  var watchSet = null;
  if (D && Array.isArray(D.watchlist)) {
    watchSet = {};
    D.watchlist.forEach(function (s) { watchSet[s] = true; });
  }
  var hasWatchlistFlag = rows.some(function (r) { return r.watchlist === true; });
  function isWatchlist(row) {
    if (watchSet) return !!watchSet[row.slug];
    if (hasWatchlistFlag) return row.watchlist === true;
    return num(row.tvl_usd, 0) >= floor;
  }
  function bySlug(a, b) { return (a.slug || "") < (b.slug || "") ? -1 : 1; }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.watchlist && !isWatchlist(r)) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && !(r.chains || []).includes(state.chain)) return false;
      if (q) {
        var hay = ((r.name || "") + " " + (r.slug || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      var d = 0;
      if (key === "implied") d = num(b.implied_value_usd, 0) - num(a.implied_value_usd, 0);
      else if (key === "tvl") d = num(b.tvl_usd, 0) - num(a.tvl_usd, 0);
      else if (key === "growth") d = num(b.change_7d, 0) - num(a.change_7d, 0);
      else if (key === "age") d = num(b.age_days, -1) - num(a.age_days, -1);
      else d = num(a.rank, 1e9) - num(b.rank, 1e9);
      return d !== 0 ? d : bySlug(a, b);
    });
    return out;
  }

  /* ---------- rendering ---------- */

  function renderMeta() {
    document.getElementById("meta-asof").textContent = (D && D.as_of) || "2026-11-14";
    document.getElementById("meta-source").textContent = "DefiLlama";
    var v = (D && D.model_version) || ((D && D.model && D.model.version) || "radar-2");
    document.getElementById("meta-model").textContent = v;
  }

  function renderStats() {
    /* 758 is the sealed snapshot's protocol count (floor $5M TVL). */
    var total = num(D && D.total_protocols, 758);
    var watch = num(D && D.watchlist_size, 40);
    var board = num(D && D.board_size, rows.length);
    var liveN = Math.min(24, num(D && D.live_size, live.length));
    document.getElementById("stats").innerHTML =
      stat(total, "protocols in snapshot") +
      stat(watch, "on the watchlist (≥$50M, no token)") +
      stat(board, "rows on the ranked board") +
      stat(liveN, "live comparables shown");
    function stat(n, label) {
      return '<div class="stat"><b>' + n + '</b><span>' + esc(label) + '</span></div>';
    }
  }

  function fillSelect(el, values, current) {
    var seen = {};
    values.forEach(function (v) { if (v) seen[v] = true; });
    var opts = Object.keys(seen).sort().map(function (v) {
      return '<option value="' + esc(v) + '"' + (v === current ? " selected" : "") + '>' + esc(v) + '</option>';
    });
    el.innerHTML = '<option value="">All ' + (el.id === "category" ? "categories" : "chains") + '</option>' + opts.join("");
  }

  function renderControls() {
    fillSelect(document.getElementById("category"),
      rows.map(function (r) { return r.category; }), state.category);
    var chains = [];
    rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chains.push(c); }); });
    fillSelect(document.getElementById("chain"), chains, state.chain);
    document.getElementById("q").value = state.q;
    document.getElementById("watchlist").checked = state.watchlist;
    document.getElementById("sort").value = state.sort;
  }

  function changeCell(v) {
    var p = num(v, 0);
    var cls = p >= 0 ? "up" : "down";
    return '<span class="' + cls + '">' + pct(v) + '</span>';
  }

  function renderBoard() {
    var list = filteredRows();
    document.getElementById("count").textContent =
      list.length + " of " + rows.length + " board rows";
    document.getElementById("board-empty").hidden = list.length > 0;
    boardEl.innerHTML = list.map(function (r) {
      var sel = state.detail === r.slug ? ' class="selected"' : "";
      return '<tr data-slug="' + esc(r.slug) + '"' + sel + '>' +
        '<td class="num">' + num(r.rank, "") + '</td>' +
        '<td class="name">' + esc(r.name || r.slug) +
          (isWatchlist(r) ? '<span class="pill" title="On the $50M watchlist">WATCHLIST</span>' : "") +
          '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || "—") + '</td>' +
        '<td>' + esc(chainsText(r.chains)) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + changeCell(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '</tr>';
    }).join("");
  }

  function renderLive() {
    var top = live.slice().sort(function (a, b) {
      return num(b.mcap_usd, 0) - num(a.mcap_usd, 0);
    }).slice(0, 24);
    document.getElementById("live-body").innerHTML = top.map(function (t, i) {
      var mult = typeof t.multiple === "number" ? t.multiple
        : (num(t.tvl_usd, 0) > 0 ? num(t.mcap_usd, 0) / t.tvl_usd : null);
      return '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td class="name">' + esc(t.name || t.slug) + '<span class="slug">' + esc(t.slug) + '</span></td>' +
        '<td>' + esc(t.category || "—") + '</td>' +
        '<td>' + esc(chainsText(t.chains)) + '</td>' +
        '<td class="num">' + money(t.tvl_usd) + '</td>' +
        '<td class="num">' + money(t.mcap_usd) + '</td>' +
        '<td class="num">' + changeCell(t.change_7d) + '</td>' +
        '<td class="num">' + (mult == null ? "—" : mult.toFixed(2) + "×") + '</td>' +
        '</tr>';
    }).join("");
  }

  function renderMultiples() {
    var mults = (D && D.multiples) || [];
    mults = mults.slice().sort(function (a, b) { return num(b.multiple, 0) - num(a.multiple, 0); });
    document.getElementById("multiples-body").innerHTML = mults.map(function (m) {
      return '<tr><td>' + esc(m.category) + '</td>' +
        '<td class="num">' + num(m.multiple, 0).toFixed(2) + '×</td>' +
        '<td class="num">' + num(m.n, 0) + '</td></tr>';
    }).join("") || '<tr><td colspan="3">No multiples in data.</td></tr>';
  }

  /* ---------- detail view ---------- */

  function findRow(slug) {
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) return rows[i];
    return null;
  }
  function comparables(row) {
    return live.filter(function (t) { return t.category === row.category; })
      .sort(function (a, b) { return num(b.mcap_usd, 0) - num(a.mcap_usd, 0); })
      .slice(0, 5);
  }

  function renderDetail() {
    var row = state.detail ? findRow(state.detail) : null;
    if (!row) { detailEl.hidden = true; detailEl.innerHTML = ""; return; }
    var tvl = num(row.tvl_usd, 0);
    var cm = num(row.category_multiple, 0);
    var gm = num(row.growth_multiplier, 0);
    var mm = num(row.maturity_multiplier, 0);
    var implied = num(row.implied_value_usd, 0);
    var growthPct = row.growth_pct != null ? row.growth_pct : row.change_7d;
    var comps = comparables(row);
    var compRows = comps.map(function (t) {
      var mult = num(t.tvl_usd, 0) > 0 ? num(t.mcap_usd, 0) / t.tvl_usd : null;
      return '<tr><td>' + esc(t.name || t.slug) + '</td>' +
        '<td class="num">' + money(t.tvl_usd) + '</td>' +
        '<td class="num">' + money(t.mcap_usd) + '</td>' +
        '<td class="num">' + (mult == null ? "—" : mult.toFixed(2) + "×") + '</td></tr>';
    }).join("");
    var steps = farmStepsFor(row).map(function (s) {
      /* Split the trailing "Cost: … Time: …" out for emphasis. */
      var m = s.match(/^(.*?)\s*Cost:\s*(.*?)\s*Time:\s*(.*?)\.?$/);
      if (!m) return "<li>" + esc(s) + "</li>";
      return "<li>" + esc(m[1]) + ' <span class="cost">Cost: ' + esc(m[2]) +
        ' &middot; Time: ' + esc(m[3]) + '</span></li>';
    }).join("");
    detailEl.innerHTML =
      '<div class="detail-head">' +
        '<span class="rank-badge">RANK #' + num(row.rank, "?") + '</span>' +
        '<h2>' + esc(row.name || row.slug) + '</h2>' +
        '<span class="cat">' + esc(row.category || "") + ' &middot; ' + esc(chainsText(row.chains)) + '</span>' +
        (isWatchlist(row) ? '<span class="pill">WATCHLIST</span>' : "") +
        '<button class="detail-close" id="detail-close" type="button">Close &times;</button>' +
      '</div>' +
      '<div class="detail-grid">' +
        '<div><h3>Protocol</h3><dl class="kv">' +
          kv("Slug", row.slug) + kv("Category", row.category) +
          kv("Chains", (row.chains || []).join(", ") || "—") +
          kv("TVL", moneyFull(row.tvl_usd)) + kv("7d change", pct(row.change_7d)) +
          kv("Listed", row.listed_at || "unknown") +
          kv("Age with no token", ageText(row.age_days) + (row.age_days != null ? " (" + row.age_days + " days)" : "")) +
          kv("Token status", "records no token") +
        '</dl></div>' +
        '<div><h3>Model breakdown — radar-2</h3>' +
          '<div class="math">' +
          moneyFull(tvl) + ' TVL<br>&times; ' + cm.toFixed(3) + ' category multiple (' + esc(row.category || "") + ')<br>' +
          '&times; ' + gm.toFixed(3) + ' growth multiplier (' + pct(growthPct) + ' in 7d)<br>' +
          '&times; ' + mm.toFixed(3) + ' maturity multiplier (' + ageText(row.age_days) + ' with no token)<br>' +
          '= <span class="result">' + moneyFull(implied) + ' implied launch value</span>' +
          '</div></div>' +
        '<div class="detail-full"><h3>Farm plan — generated from this protocol</h3>' +
          '<ol class="farm">' + steps + '</ol></div>' +
        '<div class="detail-full"><h3>Category comparables — live tokens that set the ' + cm.toFixed(2) + '× multiple</h3>' +
          (comps.length
            ? '<table class="comps"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th></tr></thead><tbody>' + compRows + '</tbody></table>'
            : '<p class="note">No live token in this category in the snapshot — the global median multiple applies.</p>') +
        '</div>' +
      '</div>' +
      '<p class="fine">Implied value is a model estimate from snapshot figures (TVL, 7d growth, time with no token), not a promise of a token or an airdrop. Farm at your own risk; never pay to claim.</p>';
    detailEl.hidden = false;
    document.getElementById("detail-close").addEventListener("click", function () {
      state.detail = ""; syncUrl(); renderDetail(); renderBoard();
    });
    function kv(k, v) { return "<dt>" + esc(k) + "</dt><dd>" + esc(v == null ? "—" : v) + "</dd>"; }
  }

  /* ---------- wiring ---------- */

  function refresh() { syncUrl(); renderBoard(); }
  document.getElementById("q").addEventListener("input", function (e) { state.q = e.target.value; refresh(); });
  document.getElementById("category").addEventListener("change", function (e) { state.category = e.target.value; refresh(); });
  document.getElementById("chain").addEventListener("change", function (e) { state.chain = e.target.value; refresh(); });
  document.getElementById("watchlist").addEventListener("change", function (e) { state.watchlist = e.target.checked; refresh(); });
  document.getElementById("sort").addEventListener("change", function (e) { state.sort = e.target.value; refresh(); });
  boardEl.addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-slug]");
    if (!tr) return;
    state.detail = tr.getAttribute("data-slug");
    syncUrl(); renderDetail(); renderBoard();
    detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  /* ---------- boot ---------- */

  if (!D) {
    document.getElementById("board-body").innerHTML =
      '<tr><td colspan="8">No radar data loaded — data.js is missing or failed to load.</td></tr>';
    return;
  }
  renderMeta();
  renderStats();
  renderControls();
  renderBoard();
  renderLive();
  renderMultiples();
  renderDetail();
})();
