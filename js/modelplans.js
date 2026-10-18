// Turns a model-drafted plan (rows of rooms or a slicing tree) into the layout object the planner (2D plan, rule check,
// 3D walkthrough) uses.
import { OPEN, MARLA_SQFT, toRects, outsideDoors } from './bands.js';
import { toRects as treeRects } from './tree.js';
import { finalize, ruleFor } from './layout.js';
import { furnish, applyOverrides } from './furniture.js';
import { tidyRects } from './tidy.js';
import { balconyRoom } from './plantweak.js';
import { draftPlans, knowsStyles, knowsStoreys } from './model.js';

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
  'stairs above stairs': 'Stairs above the stairs below', 'every room reachable from the stairs': 'Every room reachable from the stairs',
  'stairs on the ground floor': 'Stairs to the first floor', 'ground-floor rooms': 'Rooms that belong downstairs',
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
  'stairs above stairs': 'The stairs come up exactly where the stairs below end.',
  'every room reachable from the stairs': 'Every room upstairs can be reached from the stairs.',
  'stairs on the ground floor': 'The ground floor has stairs for the first floor.',
};

/** One drafted plan -> planner layout object, with doors and windows from the planner's own finalize(). */
export function planToLayout(item, index) {
  const { plan } = item;
  const { w: W, d: D } = plan.plot;
  const rects0 = item.rects || (plan.tree ? treeRects(plan) : toRects(plan));
  const T = plan.tidy ? tidyRects(rects0, plan) : null;            // small plots: no entrance room; the model's own plan stays as it is
  const rects = T ? T.rects : rects0;
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
      name = r.t === 'lounge' ? (plan.floor ? 'Family Lounge' : hasDining ? 'TV Lounge' : 'Lounge & Dining') : NAMES[r.t];
      id = seenType[r.t] === 1 ? r.t : `${r.t}${seenType[r.t]}`;                // unique ids: doors and links refer to them
    }
    const room = { id, type, name, x: r.x, z: r.y, w: r.w, d: r.d };
    if (type === 'bed') room.band = Math.abs(r.y - y0) < 0.01 ? 'front' : 'back';
    rooms.push(room);
    byRect.set(r.i, room);
  }
  if (T) for (const [from, to] of T.alias) byRect.set(from, byRect.get(to));      // a merged room answers to the room that took its place
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
  const open = rects.filter((r) => r.t === 'porch' || r.t === 'terrace' || (r.t === 'courtyard' && inside(r)))
    .map((r) => ({ type: r.t, name: r.t === 'porch' ? 'Car Porch' : r.t === 'terrace' ? 'Terrace' : 'Light Well', x: r.x, z: r.y, w: r.w, d: r.d }));

  if (plan.balcony && plan.floor) {                                // a balcony in front of the first floor: only this part of the plan changes
    const br = balconyRoom(rects);
    if (br) open.push({ type: 'balcony', name: 'Balcony', x: br.x + 1, z: br.y - 4, w: Math.max(4, br.w - 2), d: 4 });
  }
  // doors to outside: the same rule the checker uses
  const rmains = rects0.filter((r) => !OPEN.has(r.t) && r.t !== 'bath');
  const od = outsideDoors(rects0, rmains, y0);
  if (T && od.main) {                                                // the entrance moved with a swapped room: its front door goes where the entrance now is
    const g = T.gone.find((x) => x.i === od.main.i);
    if (g && od.wall && od.wall[0] === 'h') od.wall = ['h', od.wall[1], g.rect.x, g.rect.x + g.rect.w];
  }
  const mergedInto = od.main && byRect.get(od.main.i);
  if (mergedInto) od.guests = od.guests.filter(([r]) => byRect.get(r.i) !== mergedInto);   // one front door per room
  const doorsOut = {
    main: od.main && od.wall && byRect.get(od.main.i) ? { room: byRect.get(od.main.i).id, wall: od.wall } : null,
    guests: od.guests.filter(([r]) => byRect.get(r.i)).map(([r, wall]) => ({ room: byRect.get(r.i).id, wall })),
  };

  const letter = String.fromCharCode(65 + index);
  const upper = !!plan.floor;                                   // a first floor: no road entrance, the stairs are its way in
  const L = {
    id: `${upper ? 'U' : 'M'}${letter}`, label: upper ? `First floor ${letter}` : `Layout ${letter}`, tag: upper ? 'First floor' : 'Naqsha model', source: 'model', text: item.text,
    plot: { w: W, d: D }, rule: plan.rule ? { ...ruleFor(W, D), ...plan.rule } : ruleFor(W, D), hidden: T ? T.walls : [], B, rooms, open, doorsOut, beds: plan.beds, narrow: B.w < 26, plan, rects, upper,
  };
  finalize(L);                                                  // doors, windows and links for the 2D plan and the 3D walkthrough
  // the planner's own checker does not know light wells; show the checker the model was trained against instead
  L.checks = item.checks.map((c) => ({ level: c.level === 'ok' ? 'ok' : 'warn', title: TITLE[c.name] || c.name, detail: c.level === 'ok' ? OK_TEXT[c.name] || '' : `Not met${c.detail ? `: ${c.detail}` : ''}.` }));
  L.score = L.checks.filter((c) => c.level === 'ok').length;
  L.covered = mains.reduce((s, r) => s + r.w * r.d, 0);
  L.furniture = applyOverrides(furnish(L), L, plan.furnPos);    // furniture for the plan and the walkthrough, with the user's own moves
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
  const { porch = 'any', family = 'any', setbacks = null, entrance = 'auto', stairs = 'auto', ...request } = prefs;
  const marla = (plot.w * plot.d) / MARLA_SQFT;
  // the visitor's own front / back / side open space (only the ones they filled in), judged by the rule checker instead of the standard
  if (setbacks && Object.keys(setbacks).length) request.rule = Object.fromEntries(Object.entries(setbacks).filter(([, v]) => Number.isFinite(v)));
  // small plots: no entrance room (the front door opens into the drawing room); single-storey houses may drop the roof stairs
  const tidy = {};
  if (entrance === 'never' || (entrance === 'auto' && marla < 10)) tidy.entrance = true;
  if (stairs === 'none' || (stairs === 'auto' && marla <= 6 && request.storeys !== 2)) tidy.stairs = false;
  if (Object.keys(tidy).length) request.tidy = tidy;
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

/** The ground floor's built box and its stairs (inside the box), the two things a first floor is drafted around.
 *  Same as box_and_stairs in tools/gen_upper.py; null when the ground floor has no stairs. */
export function boxAndStairs(rects) {
  const mains = rects.filter((r) => !OPEN.has(r.t) && r.parent === undefined && r.t !== 'bath');
  const st = mains.find((r) => r.t === 'stairs');
  if (!st) return null;
  const x0 = Math.min(...mains.map((r) => r.x)), y0 = Math.min(...mains.map((r) => r.y));
  const x1 = Math.max(...mains.map((r) => r.x + r.w)), y1 = Math.max(...mains.map((r) => r.y + r.d));
  const r2 = (v) => Math.round(v * 100) / 100;
  return { box: { x: r2(x0), y: r2(y0), w: r2(x1 - x0), d: r2(y1 - y0) }, up: { x: r2(st.x - x0), y: r2(st.y - y0), w: st.w, d: st.d } };
}

/** True when the loaded model can draw both floors of a two-storey house. */
export { knowsStoreys };

/** Share of a first floor's room area that stands over rooms of the ground floor (the rest would hang in the air). */
export function supportShare(upperRects, groundRects) {
  const built = (rs) => rs.filter((r) => !OPEN.has(r.t) && r.parent === undefined && r.t !== 'bath');
  const G = built(groundRects);
  let tot = 0, sup = 0;
  for (const r of built(upperRects)) {
    tot += r.w * r.d;
    for (const g of G) {
      const w = Math.min(r.x + r.w, g.x + g.w) - Math.max(r.x, g.x), d = Math.min(r.y + r.d, g.y + g.d) - Math.max(r.y, g.y);
      if (w > 0 && d > 0) sup += w * d;
    }
  }
  return tot ? sup / tot : 1;
}

/** First floors over a chosen ground floor: three layouts drafted by the model, each rule-checked (the stairs sit exactly
 *  above the stairs below). Empty list when the ground floor has no stairs or the model gives nothing valid. */
export async function upperLayouts(ground, prefs, onStatus, opts = {}) {
  const fb = boxAndStairs(ground.rects);
  if (!fb) return [];
  const { w, d } = ground.plot;
  const run = (minSupport) => draftPlans({ w, d, beds: prefs.beds, baths: prefs.baths, floor: fb }, {
    n: opts.n ?? 12, top: 3, temperature: opts.temperature ?? 0.8, exclude: opts.exclude, onStatus, styles: [null],
    keep: (it) => supportShare(it.rects, ground.rects) >= minSupport,
  });
  // a first floor must stand on the ground floor: rooms hanging over a yard or a car porch are not drawn if an alternative exists
  let items = await run(0.97);
  for (const lvl of [0.88, 0.7]) {
    if (items.length >= 3) break;
    const more = await run(lvl);
    const seen = new Set(items.map((i) => i.text));
    items = [...items, ...more.filter((m) => !seen.has(m.text))].slice(0, 3);
    if (opts.exclude && items.length) break;                          // Regenerate: take what there is
  }
  return items.map((it, i) => planToLayout(it, i));
}
