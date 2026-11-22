// Plan reader, browser side: a U-Net CNN (models/planreader.onnx, trained by ml/planreader.py on CubiCasa5k) labels every pixel of a floor-plan
// photo (wall, door/window, kitchen, living, bedroom, bathroom, hall, storage ...). From that this module counts the rooms, estimates the size
// of the house, and writes a request ("7 marla, 3 bedroom, 3 bath, double storey") the normal request reader (nlp.js) turns into the form.
// Everything runs on the visitor's device. The model file is optional: without it the feature stays hidden.
import { preloadModel, runtime } from './model.js';

const BASE = new URL('../models/', import.meta.url);
export const CLASSES = ['background', 'wall', 'door/window', 'outdoor', 'kitchen', 'living/dining', 'bedroom', 'bathroom', 'hall/entrance', 'storage', 'other room'];
export const COLORS = [[255, 255, 255], [40, 40, 40], [240, 170, 40], [170, 220, 150], [90, 170, 200], [230, 200, 120], [200, 120, 160], [120, 200, 230], [180, 180, 140], [150, 150, 200], [200, 160, 100]];
const N = 256, NC = CLASSES.length;
const SQFT_PER_M2 = 10.764, BED_SQFT = 150;               // a bedroom in the plans we trained on is about 150 sq ft: the scale of a photo with no ruler

let ready = null, session = null, ort = null;
/** True when this deployment ships a plan reader model. */
export const hasPlanReader = () => fetch(new URL('planreader.json', BASE), { cache: 'no-cache' }).then((r) => r.ok, () => false);

export function loadPlanReader() {
  ready ||= (async () => {
    await preloadModel();                                    // the runtime is set up with the layout model
    ort = runtime();
    const cfg = await fetch(new URL('planreader.json', BASE), { cache: 'no-cache' }).then((r) => r.json());
    const bytes = await fetch(new URL(`planreader.onnx?v=${cfg.version || 1}`, BASE)).then((r) => r.arrayBuffer());
    session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return true;
  })().catch(() => { ready = null; return false; });
  return ready;
}

/** Image (File, Blob or ImageBitmap) -> 256 x 256 letterboxed pixels (white padding) and the box the image occupies. */
async function letterbox(img) {
  const bmp = img instanceof ImageBitmap ? img : await createImageBitmap(img);
  const k = N / Math.max(bmp.width, bmp.height), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, N, N);
  g.imageSmoothingQuality = 'high'; g.drawImage(bmp, (N - w) >> 1, (N - h) >> 1, w, h);
  return { data: g.getImageData(0, 0, N, N).data, canvas: c };
}

/** Per-pixel class of a 256 x 256 RGBA picture: Uint8Array(N * N). */
export async function segment(rgba) {
  const x = new Float32Array(3 * N * N);
  for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) x[c * N * N + i] = (rgba[i * 4 + c] / 255 - 0.5) / 0.5;
  const out = await session.run({ image: new ort.Tensor('float32', x, [1, 3, N, N]) });
  const lg = out.logits.data, lab = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    let b = 0, bv = -Infinity;
    for (let c = 0; c < NC; c++) { const v = lg[c * N * N + i]; if (v > bv) { bv = v; b = c; } }
    lab[i] = b;
  }
  return lab;
}

/** Connected regions of one class: [{ area, x0, x1, y0, y1 }] with at least `min` pixels. */
export function regions(lab, cls, min = 60) {
  const seen = new Uint8Array(N * N), out = [], stack = new Int32Array(N * N);
  for (let s = 0; s < N * N; s++) {
    if (lab[s] !== cls || seen[s]) continue;
    let sp = 0, area = 0, x0 = N, x1 = 0, y0 = N, y1 = 0;
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const p = stack[--sp], px = p % N, py = (p / N) | 0;
      area++; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (const q of [px > 0 ? p - 1 : -1, px < N - 1 ? p + 1 : -1, py > 0 ? p - N : -1, py < N - 1 ? p + N : -1]) if (q >= 0 && !seen[q] && lab[q] === cls) { seen[q] = 1; stack[sp++] = q; }
    }
    if (area >= min) out.push({ area, x0, x1, y0, y1 });
  }
  return out;
}

/** What the labelled picture says about the house. */
export function summarise(lab) {
  const rooms = {};
  for (const [name, cls] of [['bed', 6], ['bath', 7], ['kitchen', 4], ['living', 5], ['hall', 8]]) rooms[name] = regions(lab, cls);
  const beds = rooms.bed.filter((r) => r.area >= 150), baths = rooms.bath.filter((r) => r.area >= 60);
  let x0 = N, x1 = 0, y0 = N, y1 = 0, built = 0;
  for (let i = 0; i < N * N; i++) {
    const c = lab[i];
    if (c === 0 || c === 3) continue;                       // empty paper and the garden are not the house
    built++;
    const px = i % N, py = (i / N) | 0;
    if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
  }
  // scale: the median bedroom is taken as 150 sq ft
  const med = beds.length ? beds.map((b) => b.area).sort((a, b) => a - b)[beds.length >> 1] : 0;
  const ftPerPx = med ? Math.sqrt(BED_SQFT / med) : 0;
  const footprint = built * ftPerPx * ftPerPx, marla = footprint / 0.65 / 225;        // built area; a plot leaves about a third open
  return { beds: beds.length, baths: baths.length, kitchens: rooms.kitchen.length, living: rooms.living.length, built, ftPerPx, footprintSqft: Math.round(footprint), marla, box: { x0, x1, y0, y1 } };
}

/** The request the normal reader understands, from the summary. */
export function requestFrom(s) {
  const parts = [];
  if (s.marla >= 2.5 && s.marla <= 60) parts.push(`${s.marla < 12 ? Math.round(s.marla) : Math.round(s.marla / 2) * 2} marla`);
  if (s.beds) parts.push(`${Math.min(8, s.beds)} bedroom`);
  if (s.baths) parts.push(`${Math.min(10, s.baths)} bath`);
  return parts.join(', ');
}

/** The labelled picture as an RGBA overlay on the plan, for showing what the network saw. */
export function overlay(canvas, lab) {
  const g = canvas.getContext('2d'), im = g.getImageData(0, 0, N, N);
  for (let i = 0; i < N * N; i++) {
    const c = lab[i]; if (c === 0) continue;
    for (let k = 0; k < 3; k++) im.data[i * 4 + k] = im.data[i * 4 + k] * 0.45 + COLORS[c][k] * 0.55;
  }
  g.putImageData(im, 0, 0);
  return canvas;
}

/** Read a plan image: { lab, summary, request, canvas } (the canvas holds the overlay). Needs loadPlanReader() to have succeeded. */
export async function readPlan(file) {
  const { data, canvas } = await letterbox(file);
  const lab = await segment(data);
  const summary = summarise(lab);
  return { lab, summary, request: requestFrom(summary), canvas: overlay(canvas, lab) };
}
