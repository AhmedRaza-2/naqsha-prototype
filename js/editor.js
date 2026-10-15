// Layout editor: drag the walls of a drafted plan to resize rooms. It edits the band plan itself (rows from the road
// to the back, rooms left to right), so every edit stays a valid tiling of the plot; the rule check is re-run live.
//   wall between two rooms in a row  -> one room grows, its neighbour shrinks
//   wall between two rows            -> one row gets deeper, the next one shallower
//   inner edges of a washroom        -> the washroom gets wider / deeper inside its room
import { planFrame, planSVG } from './svg.js';
import { OPEN } from './bands.js';

const SNAP = 0.5;
const snap = (v) => Math.round(v / SNAP) * SNAP;
const clone = (p) => JSON.parse(JSON.stringify(p));
const FIXED = new Set(['void', 'lawn']);                       // setback strips: not walls you drag

// ---------------------------------------------------------------- slicing trees: every cut is a wall you can drag
const at = (node, path) => path.reduce((n, k) => n.kids[k], node);

function treeHandles(plan) {
  const out = [];
  const isFixed = (n) => n.k === 'room' && FIXED.has(n.t);
  const isOpen = (n) => n.k === 'room' && OPEN.has(n.t);
  const go = (node, x, y, w, d, path) => {
    if (node.k === 'room') {
      if (node.bath) {
        const [bw, bd, side] = node.bath;
        const bx = side === 'L' ? x : x + w - bw;
        out.push({ kind: 'bw', tree: true, path, rw: w, rd: d, x: side === 'L' ? x + bw : x + w - bw, z0: y + d - bd, z1: y + d });
        out.push({ kind: 'bd', tree: true, path, rw: w, rd: d, z: y + d - bd, x0: bx, x1: bx + bw });
      }
      return;
    }
    const total = node.k === 'H' ? d : w;
    const parts = [...node.sizes, total - node.sizes.reduce((a, b) => a + b, 0)];
    let pos = 0;
    parts.forEach((sz, k) => {
      const kid = node.kids[k];
      if (node.k === 'H') go(kid, x, y + pos, w, sz, [...path, k]); else go(kid, x + pos, y, sz, d, [...path, k]);
      pos += sz;
      const next = node.kids[k + 1];
      if (!next || isFixed(kid) || isFixed(next) || (isOpen(kid) && isOpen(next))) return;
      out.push(node.k === 'H'
        ? { kind: 'row', tree: true, path, k, parts, z: y + pos, x0: x, x1: x + w }
        : { kind: 'col', tree: true, path, k, parts, x: x + pos, z0: y, z1: y + d });
    });
  };
  go(plan.tree, 0, 0, plan.plot.w, plan.plot.d, []);
  return out;
}

function applyTree(p, h, dx, dz) {
  if (h.kind === 'bw' || h.kind === 'bd') {
    const leaf = at(p.tree, h.path);
    if (h.kind === 'bw') leaf.bath[0] = Math.max(3, Math.min(h.rw - 1, leaf.bath[0] + snap(leaf.bath[2] === 'L' ? dx : -dx)));
    else leaf.bath[1] = Math.max(3, Math.min(h.rd - 2, leaf.bath[1] - snap(dz)));
    return p;
  }
  const node = at(p.tree, h.path);
  const horiz = node.k === 'H';
  // smallest a part may get: room for its washroom, a walkable corridor, a usable room; yards and setbacks 3 ft
  // (a split along the same axis needs the sum of its parts, a split across it the largest part)
  const minOf = (n) => {
    if (n.k !== 'room') {
      const mins = n.kids.map(minOf);
      return (n.k === 'H') === horiz ? mins.reduce((a, b) => a + b, 0) : Math.max(...mins);
    }
    if (n.bath) return Math.max(7, horiz ? n.bath[1] + 2 : n.bath[0] + 1);
    if (n.t === 'passage' || n.t === 'lobby') return 3.5;
    return OPEN.has(n.t) || n.t === 'void' ? 3 : 7;
  };
  const a = h.parts[h.k], b = h.parts[h.k + 1];
  const d = Math.max(minOf(node.kids[h.k]) - a, Math.min(b - minOf(node.kids[h.k + 1]), snap(horiz ? dz : dx)));
  node.sizes[h.k] += d;
  if (h.k + 1 < node.sizes.length) node.sizes[h.k + 1] -= d;           // the last part takes what is left by itself
  return p;
}

/** Wall positions of a plan (rows of rooms or a slicing tree), in feet. */
function handles(plan) {
  if (plan.tree) return treeHandles(plan);
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
  if (h.tree) return applyTree(p, h, dx, dz);
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
 *   onChange(layout, live) after every change; live = true while a wall is still being dragged
 *   state = { original, history } kept by the caller per layout, so switching layouts keeps undo and reset
 */
export function mountEditor(host, layout, { rebuild, onChange, undoBtn, resetBtn, state }) {
  const st = state || {};
  st.original ||= clone(layout.plan);
  st.history ||= [];
  const { original, history } = st;
  let L = layout, drag = null;
  const OPTS = { maxW: 640, maxH: 760 };
  const off = new AbortController();                            // removes the listeners when another layout is edited
  const sig = { signal: off.signal };

  // washroom edges are drawn first so a wall's grip is never hidden under a washroom edge's touch area
  const overlay = (f) => handles(L.plan).map((h, k) => {
    const horiz = h.kind === 'row' || h.kind === 'bd';
    const [x1, y1, x2, y2] = horiz ? [f.X(h.x0), f.Y(h.z), f.X(h.x1), f.Y(h.z)] : [f.X(h.x), f.Y(h.z0), f.X(h.x), f.Y(h.z1)];
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const bath = h.kind === 'bw' || h.kind === 'bd';
    return [bath, `<g class="h ${horiz ? 'hz' : 'vt'}${bath ? ' bath' : ''}" data-k="${k}">`
      + `<line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
      + `<line class="show" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
      + `<circle class="grip" cx="${mx}" cy="${my}" r="${bath ? 3.2 : 4.2}"/></g>`];
  }).sort((a, b) => b[0] - a[0]).map((x) => x[1]).join('');

  function render() {
    host.innerHTML = planSVG(L, { ...OPTS, overlay });
    undoBtn.disabled = !history.length;
    resetBtn.disabled = JSON.stringify(L.plan) === JSON.stringify(original);
  }

  function set(plan, push) {
    if (push) history.push(L.plan);
    L = rebuild(plan);
    render();
    onChange(L, false);
  }

  // pointer position in SVG units (the SVG is scaled to its box on screen)
  const svgPoint = (e) => {
    const svg = host.querySelector('svg');
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return { px: ((e.clientX - box.left) / box.width) * vb.width, py: ((e.clientY - box.top) / box.height) * vb.height };
  };

  // the edit is computed once per animation frame from the latest pointer position, and once more on release
  function update() {
    if (!drag || !drag.last) return;
    const dx = (drag.last.px - drag.start.px) / drag.s, dz = -(drag.last.py - drag.start.py) / drag.s;   // screen y grows toward the road
    const next = apply(drag.base, drag.h, dx, dz);
    if (JSON.stringify(next) !== JSON.stringify(L.plan)) { L = rebuild(next); drag.moved = true; render(); onChange(L, true); }
  }
  function end(commit) {
    if (!drag) return;
    if (drag.raf) cancelAnimationFrame(drag.raf);
    if (commit) update();                                        // a quick flick may not have reached a frame yet
    else if (drag.moved) { L = rebuild(drag.base); drag.moved = false; render(); }   // cancelled: put it back
    if (drag.moved) history.push(drag.base);
    host.classList.remove('dragging');
    drag = null;
    render();
    onChange(L, false);
  }

  host.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('g.h');
    if (!g || e.button > 0) return;
    e.preventDefault();
    const h = handles(L.plan)[+g.dataset.k];
    drag = { h, start: svgPoint(e), last: null, base: L.plan, s: planFrame(L, OPTS).s, moved: false, raf: 0 };
    host.classList.add('dragging');
  }, sig);
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.last = svgPoint(e);
    if (!drag.raf) drag.raf = requestAnimationFrame(() => { if (drag) { drag.raf = 0; update(); } });
  }, sig);
  window.addEventListener('pointerup', () => end(true), sig);
  window.addEventListener('pointercancel', () => end(false), sig);   // system gesture, second finger: undo the drag

  undoBtn.onclick = () => { if (history.length) set(history.pop(), false); };
  resetBtn.onclick = () => set(clone(original), true);
  render();
  return { get layout() { return L; }, destroy: () => { if (drag) end(true); off.abort(); } };
}
