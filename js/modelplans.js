// Turns a model-drafted plan (rows of rooms or a slicing tree) into the layout object the planner (2D plan, rule check,
// 3D walkthrough) uses.
import { OPEN, MARLA_SQFT, toRects, outsideDoors } from './bands.js';
import { toRects as treeRects } from './tree.js';
import { finalize, ruleFor } from './layout.js';
import { draftPlans, knowsStyles } from './model.js';

const KNOWN = new Set(['drawing', 'lobby', 'lounge', 'dining', 'kitchen', 'bed', 'master', 'stairs', 'passage', 'store', 'dress', 'servant', 'study', 'prayer', 'other']);
const NAMES = { drawing: 'Drawing Room', lobby: 'Entrance', dining: 'Dining', kitchen: 'Kitchen', stairs: 'Stairs', passage: 'Corridor',
  store: 'Store', dress: 'Dressing', servant: 'Servant Room', study: 'Study', prayer: 'Prayer Room', other: 'Room' };
// layout families the model was trained on (STYLE tag) and how the planner names them
export const FAMILY = { rows: 'Classic rows', compact: 'Compact', corridor: 'Side corridor', wing: 'Bedroom wing' };
const TITLE = {
  setbacks: 'Setbacks applied', coverage: 'Plot coverage', 'min room sizes': 'Minimum room sizes', 'attached baths': 'Attached baths',
  'entrance on road side': 'Entrance on the road side', 'every room reachable': 'Every room reachable', 'guest privacy': 'Guest privacy',
  'bedroom not opening into kitchen': 'Bedrooms vs kitchen', 'kitchen ventilation': 'Kitchen ventilation', 'natural light': 'Natural light',
  'bigger bedrooms': 'Bigger bedrooms', 'bigger lounge': 'Bigger hall', 'bigger kitchen': 'Bigger kitchen',
};
const OK_TEXT = {
  setbacks: 'Front, rear and side setbacks are kept for this plot size (indicative; verify with your development authority).',
  coverage: 'Built area is within the usual coverage limit.',
  'min room sizes': 'All rooms meet the minimum size guidelines.',
  'attached baths': 'Every bedroom has an attached bath.',
  'entrance on road side': 'The entrance faces the road.',
  'every room reachable': 'Every room can be reached from the main entrance.',
  'guest privacy': 'Guests reach the drawing room without passing through a bedroom.',
  'bedroom not opening into kitchen': 'No bedroom opens directly into the kitchen.',
  'kitchen ventilation': 'The kitchen has an outside wall or light well for a window.',
  'natural light': 'Bedrooms and the drawing room have an outside window.',
  'bigger bedrooms': 'Bedrooms take a larger share of the house, as you asked.',
  'bigger lounge': 'The hall (lounge) takes a larger share of the house, as you asked.',
  'bigger kitchen': 'The kitchen takes a larger share of the house, as you asked.',
};

/** One drafted plan -> planner layout object, with doors and windows from the planner's own finalize(). */
export function planToLayout(item, index) {
  const { plan } = item;
  const { w: W, d: D } = plan.plot;
  const rects = item.rects || (plan.tree ? treeRects(plan) : toRects(plan));
  const mains = rects.filter((r) => !OPEN.has(r.t) && r.t !== 'bath');
  const x0 = Math.min(...mains.map((r) => r.x)), x1 = Math.max(...mains.map((r) => r.x + r.w));
  const y0 = Math.min(...mains.map((r) => r.y)), y1 = Math.max(...mains.map((r) => r.y + r.d));
  const B = { x: x0, z: y0, w: x1 - x0, d: y1 - y0 };
  const hasDining = mains.some((r) => r.t === 'dining');

  const rooms = [];
  const byRect = new Map();
  const nBeds = mains.filter((r) => r.t === 'bed' || r.t === 'master').length;
  let bedNo = mains.some((r) => r.t === 'master') ? 1 : 0;
  const seenType = {};
  for (const r of mains) {
    if (!KNOWN.has(r.t)) continue;
    let type = r.t, name, id;
    seenType[r.t] = (seenType[r.t] || 0) + 1;
    if (r.t === 'master') { type = 'bed'; name = 'Master Bedroom'; id = 'bed1'; }
    else if (r.t === 'bed') { bedNo += 1; name = nBeds === 1 ? 'Bedroom' : `Bedroom ${bedNo}`; id = `bed${bedNo}`; }
    else {
      name = r.t === 'lounge' ? (hasDining ? 'TV Lounge' : 'Lounge & Dining') : NAMES[r.t];
      id = seenType[r.t] === 1 ? r.t : `${r.t}${seenType[r.t]}`;                // unique ids: doors and links refer to them
    }
    const room = { id, type, name, x: r.x, z: r.y, w: r.w, d: r.d };
    if (type === 'bed') room.band = Math.abs(r.y - y0) < 0.01 ? 'front' : 'back';
    rooms.push(room);
    byRect.set(r.i, room);
  }
  for (const b of rects.filter((r) => r.t === 'bath')) {
    const parent = byRect.get(b.parent);
    if (!parent) continue;
    const guest = parent.type === 'drawing';
    const common = parent.type === 'lounge';
    const bath = { id: `bath_${parent.id}`, type: guest ? 'gbath' : 'bath', name: guest ? 'Guest Bath' : common ? 'Common Bath' : 'Bath', parent: parent.id, x: b.x, z: b.y, w: b.w, d: b.d };
    rooms.push(bath);
    parent.att = bath;
  }

  // open spaces inside the house outline: the car porch beside the drawing room (small plots) and light wells
  const inside = (r) => r.x >= B.x - 0.01 && r.x + r.w <= B.x + B.w + 0.01 && r.y >= B.z - 0.01 && r.y + r.d <= B.z + B.d + 0.01;
  const open = rects.filter((r) => r.t === 'porch' || (r.t === 'courtyard' && inside(r)))
    .map((r) => ({ type: r.t, name: r.t === 'porch' ? 'Car Porch' : 'Light Well', x: r.x, z: r.y, w: r.w, d: r.d }));

  // doors to outside: the same rule the checker uses
  const rmains = rects.filter((r) => !OPEN.has(r.t) && r.t !== 'bath');
  const od = outsideDoors(rects, rmains, y0);
  const doorsOut = {
    main: od.main && od.wall && byRect.get(od.main.i) ? { room: byRect.get(od.main.i).id, wall: od.wall } : null,
    guests: od.guests.filter(([r]) => byRect.get(r.i)).map(([r, wall]) => ({ room: byRect.get(r.i).id, wall })),
  };

  const letter = String.fromCharCode(65 + index);
  const L = {
    id: `M${letter}`, label: `Layout ${letter}`, tag: 'Naqsha model', source: 'model', text: item.text,
    plot: { w: W, d: D }, rule: ruleFor(W, D), B, rooms, open, doorsOut, beds: plan.beds, narrow: B.w < 26, plan,
  };
  finalize(L);                                                  // doors, windows and links for the 2D plan and the 3D walkthrough
  // the planner's own checker does not know light wells; show the checker the model was trained against instead
  L.checks = item.checks.map((c) => ({ level: c.level === 'ok' ? 'ok' : 'warn', title: TITLE[c.name] || c.name, detail: c.level === 'ok' ? OK_TEXT[c.name] || '' : `Not met${c.detail ? `: ${c.detail}` : ''}.` }));
  L.score = L.checks.filter((c) => c.level === 'ok').length;
  L.covered = mains.reduce((s, r) => s + r.w * r.d, 0);
  return L;
}

/** Layouts for a plot and bedroom count, drafted by the trained model. Empty list if the model gives nothing valid. */
/** Layout families worth drafting for this plot (same limits as tools/gen_tree.py). */
export function familiesFor(plot, beds) {
  const marla = (plot.w * plot.d) / MARLA_SQFT;
  if (marla <= 6) return ['compact'];
  const side = marla <= 14 ? 3 : 5, Bw = plot.w - 2 * side;
  const fams = ['rows'];
  if (Bw >= 18 && Bw <= 29 && beds === 2) fams.push('corridor');
  if (Bw >= 29 && beds >= 2 && beds <= 5) fams.push('wing');
  return fams;
}

export async function modelLayouts(plot, prefs, onStatus, opts = {}) {
  const { porch = 'any', family = 'any', ...request } = prefs;
  const wantPorch = porch === 'any' ? null : porch === 'yes';
  // a model trained on layout families drafts each family that fits, so the three layouts differ in arrangement
  const styles = (await knowsStyles()) ? (family !== 'any' ? [family] : familiesFor(plot, request.beds)) : [null];
  const hasPorch = (it) => it.rects.some((r) => r.t === 'porch' || r.t === 'garage');
  const keep = (it) => (wantPorch === null || hasPorch(it) === wantPorch) && (family === 'any' || !it.style || it.style === family);
  const items = await draftPlans({ w: plot.w, d: plot.d, ...request }, {
    n: (opts.n ?? 12) + (wantPorch === null ? 0 : 6), top: 3, temperature: opts.temperature ?? 0.8, exclude: opts.exclude, onStatus, styles, keep,
  });
  return items.map((it, i) => Object.assign(planToLayout(it, i), it.style ? { tag: FAMILY[it.style] || 'Naqsha model', family: it.style } : {}));
}
