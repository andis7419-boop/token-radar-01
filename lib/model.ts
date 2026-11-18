// radar-2: a token-launch radar whose implied values are calibrated on the
// snapshot's own live market instead of a flat multiple.
//
// Every number in the board comes from the sealed snapshot and nothing else:
// a protocol's TVL, its seven-day TVL change, and how many days it has been
// tracked while recording no token. No protocol name is ever special-cased;
// the same arithmetic scores every row, and every sort ends in a slug
// tie-break so two runs of the program produce identical bytes.
//
// The model, in one line:
//   implied = TVL x categoryMultiple x growthMult x maturityMult
// where categoryMultiple is the median market-cap/TVL ratio of live
// protocols in the same category (the market's own pricing for that kind of
// protocol), growthMult rewards recent TVL growth, and maturityMult rewards
// a long run with no token recorded — pent-up launch value.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fixed constants of radar-2. The category multiple is not fixed: it
 *  is computed from the snapshot, so it is reported separately in RadarData. */
export interface RadarConstants {
  version: string;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL_VERSION = 'radar-2';

export const RADAR: RadarConstants = {
  version: 'radar-2',
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_days: 365,
};

/** How many live-token protocols the dashboard's live view carries. */
export const LIVE_ROWS = 24;

/** The largest implied value the gate accepts. */
export const IMPLIED_CAP = 100_000_000_000_000;

/** One category's calibrated multiple, with the sample count behind it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  n: number;
}

/** One ranked row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the dashboard reads it from data.js (board row + farm plan). */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** One live-token protocol for the comparables view, with its market multiple. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard needs, written to data.js by main.ts. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: RadarConstants & { global_multiple: number };
  multiples: CategoryMultiple[];
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot file cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const MULTIPLE_LOW = 0.05;
const MULTIPLE_HIGH = 3.0;

/** Deterministic string order: code-unit comparison, slug tie-breaks use it. */
function bySlug(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function clamp(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, n));
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** The middle value of a non-empty list (average of the middle two when even). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` up to `asOf`, never negative; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
}

/** True when the snapshot records no token for this protocol at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word wrapped / staked / staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name ending in a version marker: a space, then V2, v2, 2.0 or similar. */
const VERSION_ENDING = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * True when the protocol may be ranked as a farmable launch: it records no
 * token, and it is not an exchange, a bridge, a liquid-staking product, a
 * wrapped or staked product of a token that already trades, an
 * exchange-branded product, or a versioned pool of another protocol.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  const lowerName = p.name.toLowerCase();
  if (EXCHANGE_PREFIXES.some((e) => lowerName.startsWith(e.toLowerCase()))) return false;
  if (VERSION_ENDING.test(p.name)) return false;
  return true;
}

/**
 * The category multiples: for each category, the median mcap/TVL over live
 * protocols (a token recorded, mcap and TVL both positive) in that category
 * with at least 3 samples; otherwise the global median over all live
 * protocols. Every multiple is clamped to [0.05, 3.0]. Categories are
 * sorted by name; the returned map covers every live category.
 */
export function categoryMultiples(snapshot: Snapshot): { multiples: CategoryMultiple[]; globalMultiple: number; byCategory: Map<string, number> } {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const ratios = live.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const globalMultiple = ratios.length > 0 ? clamp(median(ratios), MULTIPLE_LOW, MULTIPLE_HIGH) : 1;
  const grouped = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Unknown';
    const list = grouped.get(key);
    if (list === undefined) grouped.set(key, [(p.mcap_usd as number) / p.tvl_usd]);
    else list.push((p.mcap_usd as number) / p.tvl_usd);
  }
  const multiples: CategoryMultiple[] = [...grouped.entries()]
    .map(([category, values]) => ({
      category,
      // Rounded to 4 decimals so the table agrees with the per-row
      // category_multiple values board.json and data.js carry.
      multiple: round4(values.length >= 3 ? clamp(median(values), MULTIPLE_LOW, MULTIPLE_HIGH) : globalMultiple),
      n: values.length,
    }))
    .sort((a, b) => bySlug(a.category, b.category));
  const byCategory = new Map(multiples.map((m) => [m.category, m.multiple]));
  return { multiples, globalMultiple, byCategory };
}

/** The multiple a protocol's category calibrates to (global when unlisted). */
export function multipleFor(p: SnapshotProtocol, byCategory: Map<string, number>, globalMultiple: number): number {
  if (p.category === null) return globalMultiple;
  return byCategory.get(p.category) ?? globalMultiple;
}

/** Growth factor: 1 + clamped 7-day change (per cent) / 100 x 0.6. */
export function growthMultiplier(change7d: number | null): { growthPct: number; growthMult: number } {
  const raw = typeof change7d === 'number' && Number.isFinite(change7d) ? change7d : 0;
  const growthPct = clamp(raw, RADAR.growth_floor, RADAR.growth_cap);
  return { growthPct, growthMult: 1 + (growthPct / 100) * RADAR.growth_weight };
}

/** Maturity factor: 0.7 + min(age, 1460) / 1460 x 0.5 (0.7–1.2; unknown age counts as 365 days). */
export function maturityMultiplier(age: number | null): number {
  const days = age ?? RADAR.unknown_age_days;
  return RADAR.maturity_floor + (clamp(days, 0, RADAR.maturity_days) / RADAR.maturity_days) * RADAR.maturity_range;
}

/** The full scoring of one protocol: implied value plus every factor behind it. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  byCategory: Map<string, number>,
  globalMultiple: number,
): { implied: number; categoryMultiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const categoryMultiple = multipleFor(p, byCategory, globalMultiple);
  const { growthPct, growthMult } = growthMultiplier(p.change_7d);
  const maturityMult = maturityMultiplier(age);
  const raw = p.tvl_usd * categoryMultiple * growthMult * maturityMult;
  const implied = Math.min(IMPLIED_CAP, Math.max(1, Math.round(raw)));
  return { implied, categoryMultiple, growthPct, growthMult, maturityMult, age };
}

/** The first chain a protocol names, or a neutral fallback. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Farm capital tier, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Qualifying hold length, from the protocol's age (younger: longer window). */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core farming action, naming the protocol, the chain and the capital. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC into ${name} on ${chain} and leave the supply position open`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to the main pool of ${name} on ${chain} and leave the position open`;
  }
  if (c.includes('yield') || c.includes('aggregator') || c.includes('vault') || c.includes('curator') || c.includes('allocator') || c.includes('asset management')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and put the bridged funds to work in its app`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the chain staking asset through ${name} and keep the receipt token`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('basis')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position`;
  }
  if (c.includes('prediction')) {
    return `Fund ${name} with $${capital} and take one position in an open market`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the yield-bearing asset from ${name} on ${chain} and hold it`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open`;
}

/**
 * A protocol's six-step farm plan, derived only from its own record
 * (category, chains, TVL, age). Every step is one string carrying its
 * action, its cost and its time, 20–600 characters long.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps = [
    `Use a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline on paper. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    `${coreAction(p, capital, chain)}. Cost: $${capital} of capital and about $${gas} of gas. Time: 15 minutes to set up.`,
    `Do one qualifying action every week, such as a deposit, a borrow, a swap or a vote, so the wallet stays active. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Before withdrawing, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Write the wallet address, the dates and every transaction hash in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 597)}...` : s));
}

/** The ranked board: every watchlist slug plus every rankable pre-token protocol. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const { byCategory, globalMultiple } = categoryMultiples(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor, never the ceiling: every slug is included
  // even if it failed isRankable (coverage is a gate row, never gambled).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Every rankable pre-token protocol, watchlist or below the floor alike.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, ...scoreProtocol(p, snapshot.as_of, byCategory, globalMultiple) }));
  scored.sort((a, b) => b.implied - a.implied || bySlug(a.p.slug, b.p.slug));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    category_multiple: round4(s.categoryMultiple),
    model: {
      category_multiple: round4(s.categoryMultiple),
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The live-token comparables: top 24 by market cap, exchanges excluded. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlug(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple:
        p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1e6) / 1e6 : null,
    }));
}

/** A board row in the compact form data.js carries. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.category_multiple,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** The board plus everything the dashboard renders, from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const { multiples, globalMultiple } = categoryMultiples(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: { ...RADAR, global_multiple: round4(globalMultiple) },
    multiples,
    watchlist: [...snapshot.watchlist],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** A snapshot document out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date in YYYY-MM-DD form');
  }
  if (typeof o.source !== 'string' || o.source.length === 0) {
    throw new SnapshotError('snapshot.json has no source string');
  }
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no positive integer floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const seen = new Set<string>();
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || p.slug.length === 0) {
      throw new SnapshotError(`snapshot.json protocol ${i} has no slug`);
    }
    if (seen.has(p.slug)) throw new SnapshotError(`snapshot.json repeats slug ${p.slug}`);
    seen.add(p.slug);
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new SnapshotError(`snapshot.json protocol ${i} (${p.slug}) has no name`);
    }
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) {
      throw new SnapshotError(`snapshot.json protocol ${i} (${p.slug}) has no finite TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null when it is sound:
 * watchlist coverage, ranks exactly 1..N, implied values non-increasing
 * with rank, not all identical, every implied value a positive integer
 * within the cap, and farm steps 3–12 strings of 20–600 characters each.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board has ${board.length} rows, below the 100-row floor`;
  if (board.length > 4000) return `the board has ${board.length} rows, above the 4000-row cap`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} (${board[i]!.slug}) outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > IMPLIED_CAP) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `${r.slug} has a farm step of ${trimmed.length} characters`;
      }
    }
  }
  return null;
}

/** The dashboard's dataset as one script: `window.RADAR = {...};`, no fetch. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
