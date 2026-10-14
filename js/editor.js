// Layout editor: drag the walls of a drafted plan to resize rooms. It edits the band plan itself (rows from the road
// to the back, rooms left to right), so every edit stays a valid tiling of the plot; the rule check is re-run live.
//   wall between two rooms in a row  -> one room grows, its neighbour shrinks
//   wall between two rows            -> one row gets deeper, the next one shallower
//   inner edges of a washroom        -> the washroom gets wider / deeper inside its room
import { planSVG } from './svg.js';
import { OPEN } from './bands.js';

const SNAP = 0.5;
const snap = (v) => Math.round(v / SNAP) * SNAP;
const clone = (p) => JSON.parse(JSON.stringify(p));
const FIXED = new Set(['void', 'lawn']);                       // setback strips: not walls you drag

/** Wall positions of a band plan, in feet. */
function handles(plan) {
  const out = [];
  let z = 0;
  plan.bands.forEach((b, bi) => {
    if (bi > 0) out.push({ kind: 'row', band: bi, z, x0: 0, x1: plan.plot.w });
    let x = 0;
    b.rooms.forEach((r, ri) => {
      const next = b.rooms[ri + 1];
      if (next && !FIXED.has(r.t) && !FIXED.has(next.t) && !(OPEN.has(r.t) && OPEN.has(next.t))) {
        out.push({ kind: 'col', band: bi, i: ri, x: x + r.w, z0: z, z1: z + b.d });
      }
      if (r.bath) {
        const [bw, bd, side] = r.bath;
        const bx = side === 'L' ? x : x + r.w - bw;
        out.push({ kind: 'bw', band: bi, i: ri, x: side === 'L' ? x + bw : x + r.w - bw, z0: z + b.d - bd, z1: z + b.d });
        out.push({ kind: 'bd', band: bi, i: ri, z: z + b.d - bd, x0: bx, x1: bx + bw });
      }
      x += r.w;
    });
    z += b.d;
  });
  return out;
}

/** Apply a drag of (dx, dz) feet to handle h on a copy of plan; sizes are kept within sensible limits. */
function apply(base, h, dx, dz) {
  const p = clone(base);
  const minW = (r) => Math.max(3, r.bath ? r.bath[0] + 1 : 3);
  const minD = (b) => Math.max(b.rooms.some((r) => !OPEN.has(r.t)) ? 4 : 1, ...b.rooms.map((r) => (r.bath ? r.bath[1] + 2 : 0)));
  if (h.kind === 'col') {
    const rs = p.bands[h.band].rooms, a = rs[h.i], b = rs[h.i + 1];
    const d = Math.max(minW(a) - a.w, Math.min(b.w - minW(b), snap(dx)));
    a.w += d; b.w -= d;
  } else if (h.kind === 'row') {
    const a = p.bands[h.band - 1], b = p.bands[h.band];
    const d = Math.max(minD(a) - a.d, Math.min(b.d - minD(b), snap(dz)));
    a.d += d; b.d -= d;
  } else {
    const band = p.bands[h.band], r = band.rooms[h.i];
    if (h.kind === 'bw') r.bath[0] = Math.max(3, Math.min(r.w - 1, r.bath[0] + snap(r.bath[2] === 'L' ? dx : -dx)));
    else r.bath[1] = Math.max(3, Math.min(band.d - 2, r.bath[1] - snap(dz)));
  }
  return p;
}

/**
 * Mount an editor for one layout.
 *   rebuild(plan) -> layout object (rule check, doors, windows) for an edited plan
 *   onChange(layout) is called after every change
 */
export function mountEditor(host, layout, { rebuild, onChange, undoBtn, resetBtn }) {
  const original = clone(layout.plan);
  const history = [];
  let L = layout, drag = null, queued = null;
  const OPTS = { maxW: 640, maxH: 760 };
  const off = new AbortController();                            // removes the listeners when another layout is edited
  const sig = { signal: off.signal };

  const overlay = (f) => handles(L.plan).map((h, k) => {
    const horiz = h.kind === 'row' || h.kind === 'bd';
    const [x1, y1, x2, y2] = horiz ? [f.X(h.x0), f.Y(h.z), f.X(h.x1), f.Y(h.z)] : [f.X(h.x), f.Y(h.z0), f.X(h.x), f.Y(h.z1)];
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const bath = h.kind === 'bw' || h.kind === 'bd';
    return `<g class="h ${horiz ? 'hz' : 'vt'}${bath ? ' bath' : ''}" data-k="${k}">`
      + `<line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
      + `<line class="show" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
      + `<circle class="grip" cx="${mx}" cy="${my}" r="${bath ? 3.2 : 4.2}"/></g>`;
  }).join('');

  function render() {
    host.innerHTML = planSVG(L, { ...OPTS, overlay });
    undoBtn.disabled = !history.length;
    resetBtn.disabled = JSON.stringify(L.plan) === JSON.stringify(original);
  }

  function set(plan, push) {
    if (push) history.push(L.plan);
    L = rebuild(plan);
    render();
    onChange(L);
  }

  // feet under the pointer: the plan's frame maps feet to SVG units; the SVG is scaled to its box on screen
  const toFeet = (e) => {
    const svg = host.querySelector('svg');
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const px = ((e.clientX - box.left) / box.width) * vb.width, py = ((e.clientY - box.top) / box.height) * vb.height;
    return { px, py, k: vb.width / box.width };
  };

  host.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('g.h');
    if (!g) return;
    e.preventDefault();
    const hs = handles(L.plan);
    const h = hs[+g.dataset.k];
    const f = { s: (host.querySelector('svg').viewBox.baseVal.width - 48) / L.plot.w };   // feet -> SVG units (2 x 24 margin)
    drag = { h, start: toFeet(e), base: L.plan, s: f.s, moved: false };
    host.classList.add('dragging');
  }, sig);
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const now = toFeet(e);
    const dx = (now.px - drag.start.px) / drag.s, dz = -(now.py - drag.start.py) / drag.s;   // screen y grows toward the road
    queued = apply(drag.base, drag.h, dx, dz);
    if (!drag.raf) drag.raf = requestAnimationFrame(() => {
      if (!drag) return;
      drag.raf = 0;
      if (JSON.stringify(queued) !== JSON.stringify(L.plan)) { L = rebuild(queued); drag.moved = true; render(); onChange(L); }
    });
  }, sig);
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.moved) { history.push(drag.base); render(); }
    host.classList.remove('dragging');
    drag = null;
  }, sig);

  undoBtn.onclick = () => { if (history.length) set(history.pop(), false); };
  resetBtn.onclick = () => set(clone(original), true);
  render();
  return { get layout() { return L; }, destroy: () => off.abort() };
}
