// Runs the trained Naqsha layout model in the browser (onnxruntime-web, WebAssembly, no server, no API).
// The exported graph decodes one token per call with a key/value cache (see ml/export_onnx.py).
// Everything is served from the same place as the page (models/), with real download progress, so a slow connection
// shows a percentage instead of a frozen button, and the download can start before the visitor presses Generate.
import { parse, check, score } from './bands.js';

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
  return (spaced.match(/\d+(?:\.\d+)?|[A-Za-z]+|[:|+\n]/g) || []).map((t) => stoi.get(t === 'X' ? 'x' : t));
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
    else if (t === ':' || t === 'x' || prev === 'x' || prev === '+') sep = '';
    else sep = ' ';
    if (t === '\n') sep = '';
    out += sep + t;
    prev = t;
  }
  return out;
}

const fmt = (v) => String(v);

/** The request text the model was trained on. Models trained before washroom/focus support only know PLOT and BEDS. */
function requestText({ w, d, beds, baths, focus }) {
  let t = `PLOT ${fmt(w)}x${fmt(d)} BEDS ${beds}`;
  if (stoi.has('BATHS') && baths != null) t += ` BATHS ${baths}`;
  if (stoi.has('FOCUS') && focus) t += ` FOCUS ${focus}`;
  return t;
}

/** Sample `n` plans for the request. Returns the text of each (may be invalid, the caller checks them). */
async function sample(request, { n = 12, temperature = 0.8, maxNew = 140 } = {}, onStatus) {
  const { ort } = await load();
  const prompt = requestText(request);
  const start = [vocab.bos, ...encode(prompt), vocab.nl];
  const B = n;
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

  for (let t = 0; t < start.length - 1; t++) await step(new Array(B).fill(start[t]), t);   // feed the prompt
  let cur = new Array(B).fill(start[start.length - 1]);
  let pos = start.length - 1;
  const V = vocab.tokens.length;
  const out = Array.from({ length: B }, () => []);
  const done = new Array(B).fill(false);
  for (let s = 0; s < maxNew && pos < vocab.max_len - 1; s++) {
    onStatus?.(`Drafting layouts (${Math.min(99, Math.round((s / 110) * 100))}%)`);
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
  return out.map((ids) => `${prompt}\n${decode(ids)}`);
}

/**
 * Draft layouts with the trained model and keep the best distinct ones.
 * -> [{ text, plan, checks, score }] sorted by rule score (highest first); empty if the model produced nothing valid.
 * `exclude` is a Set of plan texts to skip (used by Regenerate so the visitor sees new layouts).
 */
export async function draftPlans(request, { n = 12, top = 3, temperature = 0.8, exclude = new Set(), onStatus } = {}) {
  const texts = await sample(request, { n, temperature }, onStatus);
  const seen = new Set(exclude);
  const good = [];
  for (const text of texts) {
    if (seen.has(text)) continue;
    seen.add(text);
    try {
      const plan = parse(text);
      const checks = check(plan, request.beds);
      if (checks.some((c) => c.level === 'err')) continue;
      good.push({ text, plan, checks, score: score(checks) });
    } catch { /* malformed output: skip */ }
  }
  good.sort((a, b) => b.score - a.score);
  return good.slice(0, top);
}
