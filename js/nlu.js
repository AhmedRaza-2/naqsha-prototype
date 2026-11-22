// The request reader, second opinion: a small transformer (models/nlu.onnx, trained by ml/nlu.py) marks what every number
// in a typed or spoken request means and what the sentence asks for. It runs in the browser on the same runtime as the
// layout model. The patterns in nlp.js read first (they are exact where they match); the model fills in what they missed:
// loose word order, speech slips, Roman Urdu spellings the patterns do not list.
import { fromUrdu } from './urdu.js';
import { parseRequest, MARLA_PLOTS } from './nlp.js';
import { preloadModel, runtime } from './model.js';

const BASE = new URL('../models/', import.meta.url);
let ready = null, cfg = null, session = null, ort = null;

/** Load the reader (2.5 MB, once). Resolves to true when it can be used. */
export function loadReader() {
  ready ||= (async () => {
    await preloadModel();                                           // the runtime is set up with the layout model
    ort = runtime();
    cfg = await fetch(new URL('nlu.json', BASE), { cache: 'no-cache' }).then((r) => r.json());
    const bytes = await fetch(new URL(`nlu.onnx?v=${cfg.version || 1}`, BASE)).then((r) => r.arrayBuffer());      // a retrained reader gets a new stamp
    session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return true;
  })().catch(() => { ready = null; return false; });
  return ready;
}

// ---- the same tokenizer and hashing as ml/nlu.py
export function tokenize(text) {
  const t = text.toLowerCase().replace(/[×✕*]/g, ' x ').replace(/(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/g, ' ');
  return (t.match(/\d+(?:\.\d+)?|[a-z]+|\+/g) || []).slice(0, cfg ? cfg.maxT : 56);
}
const enc = new TextEncoder();
function fnv(s) { let h = 2166136261; for (const b of enc.encode(s)) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function grams(tok) {
  let out;
  if (/^\d/.test(tok)) { const v = parseFloat(tok); out = ['<num>', v <= 6 ? '<n1>' : v <= 12 ? '<n2>' : v <= 30 ? '<n3>' : v <= 120 ? '<n4>' : '<n5>', '#' + tok]; }
  else { const w = `<${tok}>`; out = [w]; for (const n of [2, 3, 4]) for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n)); }
  return out.slice(0, cfg.grams).map((g) => 1 + (fnv(g) % cfg.buckets));
}

const WORD = { zero: 0, no: 0, nil: 0, half: 0.5, aadha: 0.5, adha: 0.5, one: 1, ek: 1, aik: 1, single: 1, a: 1, two: 2, do: 2, couple: 2, pair: 2, double: 2, three: 3, teen: 3, triple: 3, four: 4, char: 4, chaar: 4,
  five: 5, panch: 5, paanch: 5, six: 6, chay: 6, che: 6, seven: 7, saat: 7, eight: 8, aath: 8, nine: 9, nau: 9, ten: 10, das: 10, eleven: 11, twelve: 12, barah: 12, fifteen: 15, twenty: 20, bees: 20 };
const valueOf = (tok) => (/^\d/.test(tok) ? parseFloat(tok) : WORD[tok] ?? null);

/** What the model reads in a sentence: { tokens: [{ w, tag, p }], labels: { name: probability } } or null when it is not loaded. */
export async function readNeural(text) {
  if (!session) return null;
  text = fromUrdu(text);
  const toks = tokenize(text);
  if (!toks.length) return { tokens: [], labels: {} };
  const G = cfg.grams, ids = new BigInt64Array(cfg.maxT * G);       // always the full length, the unused places empty: the exported model has a fixed sentence length
  toks.forEach((w, i) => grams(w).forEach((g, j) => { ids[i * G + j] = BigInt(g); }));
  const out = await session.run({ ids: new ort.Tensor('int64', ids, [1, cfg.maxT, G]) });
  const T = cfg.tags.length, lt = out.tags.data, ll = out.labels.data;
  const tokens = toks.map((w, i) => {
    let m = -Infinity, k = 0, sum = 0;
    for (let c = 0; c < T; c++) if (lt[i * T + c] > m) { m = lt[i * T + c]; k = c; }
    for (let c = 0; c < T; c++) sum += Math.exp(lt[i * T + c] - m);
    return { w, tag: cfg.tags[k], p: 1 / sum };
  });
  const labels = Object.fromEntries(cfg.labels.map((n, i) => [n, 1 / (1 + Math.exp(-ll[i]))]));
  return { tokens, labels };
}

/** The model's reading as the same fields parseRequest gives (only what it is sure of). */
export function fieldsOf(nr, P = 0.75) {
  const f = {};
  const first = (tag, lo, hi) => { for (const t of nr.tokens) if (t.tag === tag && t.p >= P) { const v = valueOf(t.w); if (v != null && v >= lo && v <= hi) return v; } return null; };
  const w = first('PLOT_W', 15, 250), d = first('PLOT_D', 15, 250), marla = first('MARLA', 2, 80), kanal = first('KANAL', 0.5, 4);
  if (w && d) f.plot = { w: Math.min(w, d), d: Math.max(w, d), from: 'size' };
  else if (marla && MARLA_PLOTS[Math.round(marla)]) f.plot = { w: MARLA_PLOTS[Math.round(marla)][0], d: MARLA_PLOTS[Math.round(marla)][1], marla, from: 'marla' };
  else if (kanal === 1) f.plot = { w: 50, d: 90, marla: 20, from: 'kanal' };
  else if (kanal === 0.5) f.plot = { w: 40, d: 56, marla: 10, from: 'kanal' };
  const L = (n) => (nr.labels[n] || 0) >= P;
  const up = first('BEDS_UP', 1, 4), down = first('BEDS_DOWN', 1, 6), beds = first('BEDS', 1, 8);
  if (L('floors_2') || up) f.floors = 2; else if (L('floors_1')) f.floors = 1;
  if (up) f.upBeds = up;
  if (down) f.beds = down;
  else if (beds) {
    if (f.floors === 2 && !up && beds >= 2) { f.upBeds = Math.min(4, Math.floor(beds / 2)); f.beds = beds - f.upBeds; f.total = beds; }
    else if (beds <= 6) f.beds = beds;
  }
  const baths = first('BATHS', 1, 10); if (baths) f.baths = baths;
  const cars = first('CARS', 1, 3);
  if (L('porch_no')) f.porch = 'no'; else if (cars || L('porch_yes')) f.porch = 'yes';
  if (cars && f.porch !== 'no') f.cars = cars;
  const sb = {}; for (const [tag, k] of [['SB_FRONT', 'front'], ['SB_REAR', 'rear'], ['SB_SIDE', 'side']]) { const v = first(tag, 0, 60); if (v != null) sb[k] = v; }
  if (Object.keys(sb).length) f.setbacks = sb;
  if (L('lawn_no')) f.lawn = 'no';
  if (L('terrace_no')) f.terrace = 'without'; else if (L('terrace_yes')) f.terrace = 'with';
  const omit = ['dining', 'drawing', 'study', 'store'].filter((k) => L('omit_' + k)); if (omit.length) f.omit = omit;
  for (const k of ['lounge', 'bedrooms', 'kitchen']) if (L('focus_' + k)) { f.focus = k; break; }
  if (L('stairs_none')) f.stairs = 'none';
  if (L('up_drawing') && !omit.includes('drawing')) f.upDrawing = true;
  for (const k of ['modern', 'classic', 'spanish']) if (L('style_' + k)) { f.style = k; break; }
  return f;
}

const SAY = {
  plot: (f) => ['Plot', f.plot.from === 'size' ? `${f.plot.w} x ${f.plot.d} ft` : `${f.plot.marla} marla, ${f.plot.w} x ${f.plot.d} ft`],
  floors: (f) => ['Floors', f.floors === 2 ? 'two (ground + first)' : 'one'], beds: (f) => [f.floors === 2 || f.upBeds ? 'Bedrooms downstairs' : 'Bedrooms', String(f.beds)],
  upBeds: (f) => ['Bedrooms upstairs', String(f.upBeds)], baths: (f) => ['Washrooms', String(f.baths)], porch: (f) => ['Car porch', f.porch === 'no' ? 'none' : 'yes'], cars: (f) => ['Cars', String(f.cars)],
  setbacks: (f) => ['Open space', Object.entries(f.setbacks).map(([k, v]) => `${k === 'rear' ? 'back' : k} ${v} ft`).join(', ')], lawn: () => ['Lawn', 'none, the front is car porch'],
  terrace: (f) => ['Terrace', f.terrace === 'without' ? 'none' : 'open terrace'], omit: (f) => ['Leave out', f.omit.join(', ')], focus: (f) => ['Bigger', f.focus], stairs: () => ['Stairs', 'none'],
  upDrawing: () => ['First floor', 'with a drawing room'], style: (f) => ['Style', f.style],
};

/** The patterns' reading with the model's added where the patterns found nothing. `byModel` lists the fields the model supplied. */
export function merge(rules, nr) {
  const out = { ...rules, understood: [...rules.understood], notes: rules.notes, byModel: [] };
  if (!nr) return out;
  const f = fieldsOf(nr);
  // bedrooms come as a group (total / upstairs / downstairs): the model's only when the patterns read none of them
  const bedsKnown = rules.beds || rules.upBeds;
  for (const k of ['plot', 'floors', 'beds', 'upBeds', 'baths', 'porch', 'cars', 'setbacks', 'lawn', 'terrace', 'omit', 'focus', 'stairs', 'upDrawing', 'style']) {
    if (f[k] == null || rules[k] != null) continue;
    if ((k === 'beds' || k === 'upBeds') && bedsKnown) continue;
    if (k === 'baths' && rules.bathsAttachedOnly) continue;
    if (k === 'cars' && rules.porch === 'no') continue;
    out[k] = f[k]; out.byModel.push(k);
    const [label, value] = SAY[k]({ ...out, ...f });
    out.understood.push({ label, value, model: true });
  }
  // where the patterns and the model disagree on a count (bedrooms, washrooms, open space) and the model is very sure, the model's reading stands:
  // "bedrooms should be 4 and bathrooms should be 5" is a word order the patterns take the wrong way round
  const sure = fieldsOf(nr, 0.93), eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const swap = (k, label) => {
    out[k] = sure[k]; out.byModel.push(k);
    const [lab, value] = SAY[k]({ ...out, ...sure });
    out.understood = out.understood.filter((u) => !label.includes(u.label));
    out.understood.push({ label: lab, value, model: true });
  };
  if ((sure.beds || sure.upBeds) && bedsKnown && (!eq(sure.beds, rules.beds) || !eq(sure.upBeds, rules.upBeds)) && (sure.beds != null) === (rules.beds != null || sure.upBeds != null)) {
    if (sure.upBeds && !out.floors) out.floors = 2;
    out.understood = out.understood.filter((u) => !/^Bedrooms/.test(u.label));
    delete out.beds; delete out.upBeds;
    for (const k of ['beds', 'upBeds']) if (sure[k] != null) swap(k, []);
  }
  if (sure.baths && rules.baths && sure.baths !== rules.baths) swap('baths', ['Washrooms']);
  if (sure.setbacks && rules.setbacks && !eq(sure.setbacks, rules.setbacks)) swap('setbacks', ['Open space']);
  return out;
}

/** Read a request with both: resolves to the merged fields (the patterns alone if the model is not loaded yet). */
export async function understand(text) {
  const rules = parseRequest(text);
  if (!text || !text.trim() || !(await loadReader())) return { ...rules, byModel: [] };
  return merge(rules, await readNeural(text));
}
