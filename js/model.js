// Runs the trained Naqsha layout model in the browser (onnxruntime-web, WebAssembly, no server, no API).
// The exported graph decodes one token per call with a key/value cache (see ml/export_onnx.py).
import { parse, check, score } from './bands.js';

const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const LAYERS = 6, HEADS = 8, HEAD_DIM = 32;

let loading = null;
let vocab = null;
let stoi = null;

async function load(onStatus) {
  if (!loading) {
    loading = (async () => {
      onStatus?.('Loading the model runtime (first time only)');
      const ort = await import(ORT_BASE + 'ort.wasm.min.mjs');
      ort.env.wasm.wasmPaths = ORT_BASE;
      ort.env.wasm.numThreads = 1;                            // GitHub Pages cannot send the headers multithreading needs
      ort.env.wasm.proxy = false;
      onStatus?.('Loading the Naqsha model (5 MB, first time only)');
      vocab = await (await fetch(new URL('../models/vocab.json', import.meta.url))).json();
      stoi = new Map(vocab.tokens.map((t, i) => [t, i]));
      const bytes = await (await fetch(new URL('../models/layout.onnx', import.meta.url))).arrayBuffer();
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ort, session };
    })();
    loading.catch(() => { loading = null; });                 // allow a retry after a failed load
  }
  return loading;
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

/** True when the loaded model understands the washroom and bigger-rooms preferences. */
export async function supportsPreferences() {
  await load();
  return stoi.has('BATHS') && stoi.has('FOCUS');
}

/** Sample `n` plans for the request. Returns the text of each (may be invalid, the caller checks them). */
async function sample(request, { n = 12, temperature = 0.8, maxNew = 140 } = {}, onStatus) {
  const { ort, session } = await load(onStatus);
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
    onStatus?.(`Drafting layouts (${Math.round((s / 110) * 100)}%)`);
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
 */
export async function draftPlans(request, { n = 12, top = 3, onStatus } = {}) {
  const texts = await sample(request, { n }, onStatus);
  const seen = new Set();
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
