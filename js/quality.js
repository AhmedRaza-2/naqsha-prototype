// How well a plan uses its plot, in [0, 1]: same measure as ml/quality.py (the RL reward of v16/v17), used by the planner to pick,
// among drafts that pass the same rules, the ones that use the plot best: built area near what the plot may cover, no wasted space
// inside the house, room sizes of real Pakistani plans (scaled to what the plot can hold), usable proportions, a lounge as the hub.
import { OPEN, BEDS } from './bands.js';

const MARLA = 225;
const REAL = {
  small: { bed: 143, master: 160, kitchen: 88, lounge: 178, drawing: 151, dining: 112 },
  mid: { bed: 168, master: 185, kitchen: 108, lounge: 238, drawing: 197, dining: 140 },
  large: { bed: 175, master: 200, kitchen: 130, lounge: 280, drawing: 215, dining: 155 },
};
const WEIGHTS = { use: 0.25, waste: 0.2, sizes: 0.3, shape: 0.15, hub: 0.1 };
const NO_SHAPE = new Set(['passage', 'stairs', 'lobby', 'bath', 'store', 'dress']);

const coverLimit = (m) => (m <= 6 ? 75 : m <= 8.5 ? 70 : m <= 14 ? 65 : 60);
const near = (a, t) => (a <= 0 ? 0 : Math.max(0, Math.min(1, 1 - (Math.abs(Math.log(a / t)) - 0.2) / 0.55)));

/** -> { q, parts } for a plan and its rectangles (bands/tree toRects: t, x, y, w, d, bath [w, d, side], parent). */
export function quality(plan, rects) {
  const W = plan.plot.w, D = plan.plot.d, m = (W * D) / MARLA, upper = !!plan.floor;
  const mains = rects.filter((r) => !OPEN.has(r.t) && r.t !== 'bath');
  if (!mains.length) return { q: 0, parts: {} };
  const built = mains.reduce((s, r) => s + r.w * r.d, 0);
  const x0 = Math.min(...mains.map((r) => r.x)), x1 = Math.max(...mains.map((r) => r.x + r.w));
  const y0 = Math.min(...mains.map((r) => r.y)), y1 = Math.max(...mains.map((r) => r.y + r.d));
  const box = (x1 - x0) * (y1 - y0), parts = {};
  if (!upper) parts.use = Math.max(0, Math.min(1, (100 * built) / (W * D) / (0.92 * coverLimit(m))));
  const inside = rects.filter((r) => (r.t === 'void' || r.t === 'courtyard') && r.x >= x0 - 0.01 && r.x + r.w <= x1 + 0.01 && r.y >= y0 - 0.01 && r.y + r.d <= y1 + 0.01)
    .reduce((s, r) => s + r.w * r.d, 0);
  parts.waste = Math.max(0, 1 - Math.max(0, inside / Math.max(box, 1) - 0.04) / 0.16);
  const real = REAL[m <= 6 ? 'small' : m <= 14 ? 'mid' : 'large'];
  const avail = 0.7 * (upper ? box : (W * D * coverLimit(m)) / 100);
  const need = mains.filter((r) => real[r.t]).reduce((s, r) => s + real[r.t], 0) || 1;
  const fit = Math.min(1, avail / need);
  const sz = mains.filter((r) => real[r.t]).map((r) => near(r.w * r.d - (r.bath ? r.bath[0] * r.bath[1] : 0), real[r.t] * fit));
  parts.sizes = sz.length ? sz.reduce((a, b) => a + b, 0) / sz.length : 1;
  const sh = mains.filter((r) => !NO_SHAPE.has(r.t)).map((r) => Math.min(1, 1.8 / (Math.max(r.w, r.d) / Math.max(Math.min(r.w, r.d), 0.5))));
  parts.shape = sh.length ? (sh.reduce((a, b) => a + b, 0) / sh.length) ** 2 : 1;
  const beds = mains.filter((r) => BEDS.has(r.t)).length;
  parts.hub = beds < 2 || mains.some((r) => r.t === 'lounge') ? 1 : 0;
  let s = 0, wsum = 0;
  for (const k of Object.keys(parts)) { s += parts[k] * WEIGHTS[k]; wsum += WEIGHTS[k]; }
  return { q: s / wsum, parts };
}
