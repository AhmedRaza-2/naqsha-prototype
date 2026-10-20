// Runs the trained Naqsha layout model in the browser (onnxruntime-web, WebAssembly, no server, no API).
// The exported graph decodes one token per call with a key/value cache (see ml/export_onnx.py).
// Everything is served from the same place as the page (models/), with real download progress, so a slow connection
// shows a percentage instead of a frozen button, and the download can start before the visitor presses Generate.
import { score, check as rowCheck, toRects as rowRects } from './bands.js';
import { parseAny, familyOf, check as treeCheck, toRects as treeRects } from './tree.js';
import { polish, refine, tuck, outlineKey } from './polish.js';

const BASE = new URL('../models/', import.meta.url);
const LAYERS = 6, HEADS = 8, HEAD_DIM = 32;

// ---------------------------------------------------------------- loading with progress
const state = { phase: 'idle', pct: 0, error: null };       // idle | loading | ready | error
const listeners = new Set();
let loading = null;
let ortRef = null, session = null, vocab = null, stoi = null;

const publish = (patch) => { Object.assign(state, patch); listeners.forEach((f) => f({ ...state })); };

/** Subscribe to loading progress: fn({ phase, pct, error }). Returns an unsubscribe function. */
export function onModelState(fn) {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

const STALL_MS = 30000;   // a download that receives nothing for this long has stalled: fail it, so Generate can retry

async function fetchBytes(url, onChunk) {
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(), STALL_MS);
  const res = await fetch(url, { cache: 'force-cache', signal: ctl.signal });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read().catch((e) => { throw ctl.signal.aborted ? new Error('the download stalled') : e; });
    clearTimeout(timer);
    if (done) break;
    timer = setTimeout(() => ctl.abort(), STALL_MS);
    parts.push(value);
    got += value.length;
    onChunk(got);
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Start (or join) the download and set-up of the model. Safe to call many times. */
export function preloadModel() {
  if (!loading) {
    publish({ phase: 'loading', pct: 0, error: null });
    loading = (async () => {
      const manifest = await (await fetch(new URL('manifest.json', BASE), { cache: 'no-cache' })).json();
      const v = `?v=${manifest.version || 0}`;                // files are cached for a year; a new model gets a new stamp
      const total = manifest.onnx + manifest.wasm;
      const done = { onnx: 0, wasm: 0 };
      const report = () => publish({ pct: Math.min(99, Math.round(((done.onnx + done.wasm) / total) * 100)) });
      const [vocabJson, onnxBytes, wasmBytes] = await Promise.all([
        fetch(new URL(`vocab.json${v}`, BASE)).then((r) => r.json()),
        fetchBytes(new URL(`layout.onnx${v}`, BASE), (n) => { done.onnx = n; report(); }),
        fetchBytes(new URL(`ort/ort-wasm-simd-threaded.wasm${v}`, BASE), (n) => { done.wasm = n; report(); }),
      ]);
      vocab = vocabJson;
      stoi = new Map(vocab.tokens.map((t, i) => [t, i]));
      // the runtime's .mjs files are shipped as .js: simple static servers (python http.server on Windows) send .mjs as text/plain
      const ort = await import(new URL('ort/ort.wasm.min.js', BASE).href);
      ort.env.wasm.wasmPaths = { mjs: new URL('ort/ort-wasm-simd-threaded.js', BASE).href, wasm: new URL('ort/ort-wasm-simd-threaded.wasm', BASE).href };
      ort.env.wasm.wasmBinary = wasmBytes;                    // already downloaded above, with progress
      ort.env.wasm.numThreads = 1;                            // static hosting cannot send the headers multithreading needs
      ort.env.wasm.proxy = false;
      session = await ort.InferenceSession.create(onnxBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      ortRef = ort;
      publish({ phase: 'ready', pct: 100 });
    })().catch((err) => {
      loading = null;                                         // allow a retry
      publish({ phase: 'error', error: String(err && err.message || err) });
      throw err;
    });
  }
  return loading;
}

async function load() {
  await preloadModel();
  return { ort: ortRef, session };
}

// ---------------------------------------------------------------- tokenizer (same rules as ml/layoutlm.py)
function encode(text) {
  const spaced = text.replace(/(?<=\d)x(?=\d)/g, ' X ');
  return (spaced.match(/\d+(?:\.\d+)?|[A-Za-z]+|[:|+\n\[\]]/g) || []).map((t) => stoi.get(t === 'X' ? 'x' : t));
}

function decode(ids) {
  let out = '';
  let prev = null;
  for (const i of ids) {
    if (i === vocab.pad || i === vocab.bos) continue;
    if (i === vocab.eos) break;
    const t = vocab.tokens[i];
    let sep;
    if (prev === null || prev === '\n') sep = '';
    else if (t === ':' || t === 'x' || t === ']' || prev === 'x' || prev === '+' || prev === '[') sep = '';
    else sep = ' ';
    if (t === '\n') sep = '';
    out += sep + t;
    prev = t;
  }
  return out;
}

const fmt = (v) => String(v);

/** The request text the model was trained on. Models trained before washroom/focus support only know PLOT and BEDS. */
function requestText({ w, d, beds, baths, focus, storeys, floor }, style) {
  let t = `PLOT ${fmt(w)}x${fmt(d)}`;
  if (floor) t += ` FLOOR 1 BOX ${[floor.box.x, floor.box.y, floor.box.w, floor.box.d].map(fmt).join(' ')} UP ${[floor.up.x, floor.up.y, floor.up.w, floor.up.d].map(fmt).join(' ')}`;
  t += ` BEDS ${beds}`;
  if (stoi.has('BATHS') && baths != null) t += ` BATHS ${baths}`;
  if (stoi.has('FOCUS') && focus && !floor) t += ` FOCUS ${focus}`;
  if (storeys === 2 && stoi.has('STOREYS')) t += ' STOREYS 2';
  if (style && stoi.has('STYLE') && stoi.has(style)) t += ` STYLE ${style}`;
  return t;
}

/** True when the loaded model can draw two-storey houses (ground floors with stairs, first floors over them). */
export async function knowsStoreys() {
  await load();
  return stoi.has('FLOOR') && stoi.has('STOREYS') && stoi.has('terrace');
}

/** True when the loaded model was trained with layout families (STYLE tags, slicing trees). */
export async function knowsStyles() {
  await load();
  return stoi.has('STYLE') && stoi.has('wing');
}

/** Sample plans: one per entry of `styles` (null = no style tag). Rows whose prompts have the same length share one
 *  batch and one key/value cache. Returns [{ text, style }] (may be invalid, the caller checks them). */
async function sample(request, styles, { temperature = 0.8, maxNew = 170 } = {}, onStatus) {
  await load();                                                     // the prompt depends on the loaded vocabulary
  const groups = new Map();
  styles.forEach((st) => {
    const prompt = requestText(request, st);
    const ids = [vocab.bos, ...encode(prompt), vocab.nl];
    const key = ids.length;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ prompt, ids, style: st });
  });
  const out = [];
  let g = 0;
  for (const rows of groups.values()) {
    g += 1;
    const texts = await sampleBatch(rows, temperature, maxNew, expectedLength(request), (pct) => onStatus?.(`Drafting layouts (${Math.min(99, Math.round(((g - 1 + pct) / groups.size) * 100))}%)`));
    rows.forEach((r, i) => out.push({ text: texts[i], style: r.style }));
  }
  return out;
}

/** About how many words the model writes for a plan on this plot (measured on v11: 47 on 3 marla, 68 on 6, 120 from
 *  14 marla up), so the progress shown while drafting runs to about 100% instead of stopping half way. */
const expectedLength = ({ w, d, floor }) => Math.min(125, Math.max(42, 22 + 6.8 * ((w * d) / 225))) * (floor ? 0.55 : 1);

async function sampleBatch(rows, temperature, maxNew, expected, progress) {
  const { ort } = await load();
  const B = rows.length;
  const L0 = rows[0].ids.length;
  let k = new ort.Tensor('float32', new Float32Array(0), [LAYERS, B, HEADS, 0, HEAD_DIM]);
  let v = new ort.Tensor('float32', new Float32Array(0), [LAYERS, B, HEADS, 0, HEAD_DIM]);
  const step = async (tokens, pos) => {
    const feeds = {
      ids: new ort.Tensor('int64', BigInt64Array.from(tokens, (t) => BigInt(t)), [B, 1]),
      pos: new ort.Tensor('int64', BigInt64Array.from([BigInt(pos)]), [1]),
      past_k: k, past_v: v,
    };
    const o = await session.run(feeds);
    k = o.k; v = o.v;
    return o.logits.data;
  };
  for (let t = 0; t < L0 - 1; t++) await step(rows.map((r) => r.ids[t]), t);   // feed the prompts (one per row)
  let cur = rows.map((r) => r.ids[L0 - 1]);
  let pos = L0 - 1;
  const V = vocab.tokens.length;
  const out = Array.from({ length: B }, () => []);
  const done = new Array(B).fill(false);
  for (let s = 0; s < maxNew && pos < vocab.max_len - 1; s++) {
    progress(Math.min(0.99, s / expected));
    const logits = await step(cur, pos);
    const next = new Array(B);
    for (let b = 0; b < B; b++) {
      const row = logits.subarray(b * V, (b + 1) * V);
      let mx = -Infinity;
      for (let i = 0; i < V; i++) if (row[i] > mx) mx = row[i];
      let sum = 0;
      const p = new Float64Array(V);
      for (let i = 0; i < V; i++) { p[i] = Math.exp((row[i] - mx) / temperature); sum += p[i]; }
      let r = Math.random() * sum, pick = V - 1;
      for (let i = 0; i < V; i++) { r -= p[i]; if (r <= 0) { pick = i; break; } }
      next[b] = pick;
      if (!done[b]) { out[b].push(pick); if (pick === vocab.eos) done[b] = true; }
    }
    cur = next; pos++;
    if (done.every(Boolean)) break;
    if (s % 8 === 0) await new Promise((r) => setTimeout(r, 0));                    // let the page repaint
  }
  return out.map((ids, b) => `${rows[b].prompt}\n${decode(ids)}`);
}

/**
 * Draft layouts with the trained model and keep the best, most different ones.
 * styles: layout families to draft (each gets n / styles.length samples); [null] = no style tag (older models).
 * -> [{ text, plan, rects, checks, score, style }]: first the best plan of each family that produced a valid one,
 *    then the next best overall; empty if the model produced nothing valid. `style` is the family the plan really has
 *    (read from its geometry: the model does not always follow the STYLE tag); null for models without styles.
 * `exclude` is a Set of plan texts to skip (used by Regenerate so the visitor sees new layouts).
 * `keep(item)` drops plans the visitor ruled out (a car porch, a family) before the best of each family is picked.
 */
/** Sample raw drafts only (no checking): [{ text, style }], to be filtered and finished by several draftPlans calls via `drafts`. */
export async function sampleDrafts(request, { n = 12, temperature = 0.8, onStatus, styles = [null] } = {}) {
  const per = Math.max(1, Math.round(n / styles.length));
  return sample(request, styles.flatMap((st) => new Array(per).fill(st)), { temperature }, onStatus);
}

/** How cramped a plan's rooms are against comfortable sizes (the rule check's minimums are lower): 0 when none is, more when rooms are small.
 *  Used to prefer the roomier of plans that pass the same rules. */
const COMFORT = { bed: [110, 10], master: [140, 11], drawing: [130, 10], lounge: [120, 9], kitchen: [75, 7.5], dining: [70, 7], lobby: [25, 4.5], study: [80, 8], bath: [28, 4.5] };
export function cramped(rects) {
  let c = 0;
  for (const r of rects) {
    const m = COMFORT[r.t];
    if (!m) continue;
    c += Math.max(0, (m[0] - r.w * r.d) / m[0]) + Math.max(0, (m[1] - Math.min(r.w, r.d)) / m[1]);
  }
  return c;
}

export async function draftPlans(request, { n = 12, top = 3, temperature = 0.8, exclude = new Set(), onStatus, styles = [null], keep = () => true, hang = null, embed = null, drafts: given = null } = {}) {
  const per = Math.max(1, Math.round(n / styles.length));
  const want = styles.flatMap((st) => new Array(per).fill(st));
  const drafts = given || await sample(request, want, { temperature }, onStatus);        // `given`: drafts sampled earlier, shared by several calls
  const seen = new Set(exclude);
  const good = [];
  for (const { text, style } of drafts) {
    if (seen.has(text)) continue;
    seen.add(text);
    try {
      const parsed = parseAny(text, request.beds);
      let { plan, rects } = parsed;
      const fam = style && familyOf(plan, rects);                          // read from the plan as the model drew it
      let changed = false;
      if (embed && plan.tree) { plan = embed(plan); rects = treeRects(plan); changed = true; }   // the plan is changed on its way in (extra open space, no terrace)
      if (request.rule) plan.rule = request.rule;                           // the visitor's own open space: judged against that, not the standard
      if (request.tidy) plan.tidy = request.tidy;
      const checks = request.rule || changed ? (plan.tree ? treeCheck(plan, request.beds) : rowCheck(plan, request.beds)) : parsed.checks;
      if (checks.some((c) => c.level === 'err')) continue;
      const item = { text, plan, rects, checks, score: score(checks), style: fam, cramp: cramped(rects) };
      if (keep(item)) good.push(item);
    } catch (e) { if (window.__S) console.log('[draft skip]', String(e.message).slice(0, 80), text.slice(0, 220)); /* malformed output: skip */ }
  }
  // a two-storey ground floor keeps its outline and stairs while it is adjusted: the first floor is drafted over them
  const keepOutline = (g) => {
    if (request.storeys !== 2) return null;
    const k0 = outlineKey(g.rects);
    return (p) => outlineKey(p.tree ? treeRects(p) : rowRects(p)) === k0;
  };
  // plans that miss a rule by a little are nudged into shape by the rule checker (polish.js) before the best are picked
  const t0 = Date.now();
  for (const g of good.filter((x) => x.score < 1).sort((a, b) => b.score - a.score)) {
    if (Date.now() - t0 > 1500) break;
    const beds = request.beds;
    const same = keepOutline(g);
    const r = polish(g.plan, (p) => (p.tree ? treeCheck(p, beds) : rowCheck(p, beds)), { budgetMs: 200, same });
    if (!r) continue;
    Object.assign(g, { plan: r.plan, checks: r.checks, score: r.score, rects: r.plan.tree ? treeRects(r.plan) : rowRects(r.plan), polished: r.moves });
  }
  good.sort((a, b) => (b.score - a.score) || (a.cramp - b.cramp));       // among plans that pass the same rules, the roomier first
  const picked = [];
  for (const st of styles) {                                          // the best plan of each family first: three different layouts
    const best = good.find((g) => g.style === st && !picked.includes(g));
    if (best && picked.length < top) picked.push(best);
  }
  // then, among the plans that score as well as the best one left, the one least like the cards already picked
  // (a mirror image counts as the same layout), so the cards do not show one house three times
  while (picked.length < top) {
    const rest = good.filter((g) => !picked.includes(g));
    if (!rest.length) break;
    const roomy = Math.min(...rest.filter((g) => g.score >= rest[0].score - 0.05).map((g) => g.cramp));
    const near = rest.filter((g) => g.score >= rest[0].score - 0.05 && g.cramp <= roomy + 0.25);      // not much more cramped than the roomiest of them
    const apart = (g) => Math.min(...picked.map((p) => layoutDistance(g, p)));
    picked.push(picked.length ? near.reduce((a, b) => (apart(b) > apart(a) ? b : a)) : near[0]);
  }
  // the picked plans: rooms grown toward the sizes of real Pakistani plans, without losing any rule the plan passes
  // (text stays the model's own, which is what Regenerate leaves out)
  for (const g of picked) {
    const beds = request.beds;
    const toR = (p) => (p.tree ? treeRects(p) : rowRects(p));
    const r = refine(g.plan, (p) => (p.tree ? treeCheck(p, beds) : rowCheck(p, beds)), toR, { budgetMs: 180, same: keepOutline(g) });
    if (!r) continue;
    Object.assign(g, { plan: r.plan, checks: r.checks, score: score(r.checks), rects: toR(r.plan), refined: r.moves });
  }
  // a first floor: rooms drawn out over the yard are pulled back over the ground floor when that costs no rule
  if (hang) {
    for (const g of picked) {
      const beds = request.beds;
      const toR = (p) => (p.tree ? treeRects(p) : rowRects(p));
      const r = tuck(g.plan, (p) => (p.tree ? treeCheck(p, beds) : rowCheck(p, beds)), toR, hang);
      if (!r) continue;
      Object.assign(g, { plan: r.plan, checks: r.checks, score: score(r.checks), rects: toR(r.plan), tucked: r.moves });
    }
  }
  return picked;
}

/** Room type of every 1 ft cell (washrooms over their rooms); cached on the item. */
function gridOf(item) {
  if (item.grid) return item.grid;
  const W = Math.round(item.plan.plot.w), D = Math.round(item.plan.plot.d);
  const g = new Array(W * D).fill('');
  for (const r of [...item.rects].sort((a, b) => (a.parent != null) - (b.parent != null))) {
    for (let y = Math.floor(r.y); y < Math.min(D, Math.floor(r.y + r.d)); y++) {
      for (let x = Math.floor(r.x); x < Math.min(W, Math.floor(r.x + r.w)); x++) g[y * W + x] = r.t;
    }
  }
  item.grid = { g, W, D };
  return item.grid;
}

/** Share of the plot where two plans put a different kind of room, the smaller of as drawn and mirrored. */
function layoutDistance(a, b) {
  const A = gridOf(a), B = gridOf(b);
  if (A.W !== B.W || A.D !== B.D) return 1;
  let same = 0, mirrored = 0;
  for (let y = 0; y < A.D; y++) {
    for (let x = 0; x < A.W; x++) {
      const t = A.g[y * A.W + x];
      same += t !== B.g[y * A.W + x];
      mirrored += t !== B.g[y * A.W + (A.W - 1 - x)];
    }
  }
  return Math.min(same, mirrored) / (A.W * A.D);
}
