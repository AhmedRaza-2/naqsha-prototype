// Small changes to one part of a drafted plan, leaving the rest alone: the car porch (an open space swapped with the lawn
// beside it) and a balcony in front of the first floor. Each returns a changed copy of the plan, or null when the plan
// has no room for the change. The checker and the drawing then work from the changed plan as usual.
import { OPEN } from './bands.js';
import { ruleFor, turningStair, STAIR_ROOM } from './layout.js';

const clone = (p) => JSON.parse(JSON.stringify(p));

/** Every room of a plan (tree or rows) with its geometry and the object to edit: [{ node, t, x, y, w, d }]. */
function rooms(plan) {
  const out = [];
  if (plan.tree) {
    const go = (node, x, y, w, d) => {
      if (node.k === 'room') { out.push({ node, t: node.t, x, y, w, d }); return; }
      const total = node.k === 'H' ? d : w;
      const rest = total - node.sizes.reduce((a, b) => a + b, 0);
      let pos = 0;
      [...node.sizes, rest].forEach((s, k) => {
        if (node.k === 'H') go(node.kids[k], x, y + pos, w, s); else go(node.kids[k], x + pos, y, s, d);
        pos += s;
      });
    };
    go(plan.tree, 0, 0, plan.plot.w, plan.plot.d);
  } else {
    let y = 0;
    for (const b of plan.bands) {
      let x = 0;
      for (const r of b.rooms) { out.push({ node: r, t: r.t, x, y, w: r.w, d: b.d }); x += r.w; }
      y += b.d;
    }
  }
  return out;
}

/** Does the ground floor have a car porch? */
export const hasPorch = (plan) => rooms(plan).some((r) => r.t === 'porch');

/**
 * mode 'no': the car porch becomes lawn. mode 'yes': the widest lawn strip along the front (at least 9 ft wide, 11 ft deep)
 * becomes a car porch, preferably beside the front door. Anything else is left as drafted.
 */
export function setPorch(plan, mode) {
  const p = clone(plan);
  const rs = rooms(p);
  if (mode === 'no') {
    const porches = rs.filter((r) => r.t === 'porch');
    if (!porches.length) return null;
    porches.forEach((r) => { r.node.t = 'lawn'; });
    return p;
  }
  if (mode === 'yes') {
    if (rs.some((r) => r.t === 'porch')) return null;
    const mains = rs.filter((r) => !OPEN.has(r.t) && r.t !== 'bath');
    if (!mains.length) return null;
    const y0 = Math.min(...mains.map((r) => r.y));
    const front = rs.filter((r) => r.t === 'lawn' && r.y < 0.01 && r.y + r.d >= y0 - 0.01 && r.w >= 9 && r.d >= 11);
    if (!front.length) return null;
    const lobby = mains.find((r) => r.t === 'lobby' && Math.abs(r.y - y0) < 0.01);
    const near = (r) => (lobby ? Math.min(Math.abs(r.x - (lobby.x + lobby.w)), Math.abs(r.x + r.w - lobby.x)) : 0);
    front.sort((a, b) => near(a) - near(b) || b.w - a.w);
    front[0].node.t = 'porch';
    return p;
  }
  return null;
}

/** A balcony in front of the first floor, over its widest front room (the layout adds the door and the slab). */
export function setBalcony(plan, on) {
  if (!plan.floor) return null;
  const p = clone(plan);
  if (on) p.balcony = true; else delete p.balcony;
  return p;
}

/** The first-floor rooms a balcony could go in front of (a room on the front wall, at least 8 ft wide). */
export function balconyRoom(rects) {
  const mains = rects.filter((r) => !OPEN.has(r.t) && r.parent === undefined && r.t !== 'bath');
  if (!mains.length) return null;
  const y0 = Math.min(...mains.map((r) => r.y));
  return mains.filter((r) => Math.abs(r.y - y0) < 0.01 && ['bed', 'master', 'lounge', 'study', 'dining', 'other'].includes(r.t) && r.w >= 8).sort((a, b) => b.w - a.w)[0] || null;
}

// ---------------------------------------------------------------- the visitor's own open space (setbacks)
/**
 * The model draws for the standard open space of a plot size. When the visitor asks for more on a side than that, the model
 * is asked for a slightly smaller plot and the drawing is wrapped in extra open strips, so every gap is met by construction
 * instead of by squeezing rooms afterwards. -> { w, d, l, r, f, b } (the inner plot and the extra strips) or null when
 * nothing extra is needed or the inner plot would be too small for the model.
 */
export function insetFor(W, D, own) {
  if (!own) return null;
  const want = (k) => (Number.isFinite(own[k]) ? own[k] : null);
  let w = W, d = D, last = '';
  for (let i = 0; i < 5; i++) {
    const rl = ruleFor(w, d);
    const es = want('side') != null ? Math.max(0, want('side') - rl.side) : 0;
    const ef = want('front') != null ? Math.max(0, want('front') - rl.front) : 0;
    const er = want('rear') != null ? Math.max(0, want('rear') - rl.rear) : 0;
    const nw = Math.floor(W - 2 * es + 1e-9), nd = Math.floor(D - ef - er + 1e-9);
    const key = nw + 'x' + nd;
    w = nw; d = nd;
    if (key === last) break;
    last = key;
  }
  if (w >= W && d >= D) return null;
  if (w < 18 || d < 30) return null;
  const rl = ruleFor(w, d);
  const side = (W - w) / 2;
  let f = 0, b = 0;
  const extraD = D - d;
  const needF = want('front') != null ? Math.max(0, want('front') - rl.front) : 0, needR = want('rear') != null ? Math.max(0, want('rear') - rl.rear) : 0;
  if (needF > 0 && needR > 0) { f = needF; b = extraD - f; } else if (needF > 0) f = extraD; else if (needR > 0) b = extraD; else f = extraD;
  // every side the visitor named must now be at least what they asked for
  if (want('side') != null && rl.side + side < want('side') - 0.01) return null;
  if (want('front') != null && rl.front + f < want('front') - 0.01) return null;
  if (want('rear') != null && rl.rear + b < want('rear') - 0.01) return null;
  return { w, d, l: side, r: side, f, b };
}

/** A tree plan drawn for the inner plot, wrapped in open strips on a plot of W x D (front lawn, rear and side voids). */
export function wrapGround(plan, W, D, ins) {
  if (!plan.tree) return plan;
  const cut = (k, before, size, total, kid, t) => {
    const after = Math.round((total - before - size) * 100) / 100;
    const sizes = [], kids = [];
    if (before > 0.01) { sizes.push(before); kids.push({ k: 'room', t }); }
    kids.push(kid);
    if (after > 0.01) { sizes.push(size); kids.push({ k: 'room', t: k === 'H' ? 'void' : t }); }
    return kids.length === 1 ? kid : { k, sizes, kids };
  };
  const p = clone(plan);
  let t = cut('V', ins.l, ins.w, W, p.tree, 'void');
  t = cut('H', ins.f, ins.d, D, t, 'lawn');
  p.tree = t;
  p.plot = { w: W, d: D };
  p.inset = { l: ins.l, r: ins.r, f: ins.f, b: ins.b };
  return p;
}

// ---------------------------------------------------------------- a first floor without a terrace
/**
 * The terrace of a first floor is the open roof of the floor below that the first floor does not cover. This takes it away:
 * a neighbouring room grows over it (the one behind it, or before it when it is last); when the only neighbour holds the
 * stairs, which must stay exactly above the stairs below, the terrace becomes a sitting room of its own instead. A terrace that has
 * only open space beside it is left alone. Returns a changed copy of the plan, or the same plan when it has no terrace.
 */
export function dropTerrace(plan) {
  if (!plan.tree) return plan;
  const isOpen = (n) => n.k === 'room' && OPEN.has(n.t);
  const has = (n, t) => (n.k === 'room' ? n.t === t : n.kids.some((k) => has(k, t)));
  const go = (node) => {
    if (node.k === 'room') return node;
    node.kids = node.kids.map(go);
    for (let guard = 0; guard < 8; guard++) {
      const i = node.kids.findIndex((k) => k.k === 'room' && k.t === 'terrace');
      if (i < 0) break;
      const last = node.kids.length - 1;
      const grows = (j) => j >= 0 && j <= last && !isOpen(node.kids[j]) && !has(node.kids[j], 'stairs');
      const next = i < last && grows(i + 1) ? i + 1 : null;
      const prev = i > 0 && grows(i - 1) ? i - 1 : null;
      if (next == null && prev == null) {
        const beside = [node.kids[i - 1], node.kids[i + 1]].filter(Boolean);
        if (beside.every(isOpen)) break;                                 // only open space beside it: nothing to do
        node.kids[i] = { k: 'room', t: 'lounge' };                       // a sitting room of its own (it connects to the stairs and the rooms around), the neighbours stay as they are
        continue;
      }
      const s = i < last ? node.sizes[i] : 0;
      if (next != null) {
        if (next < last) node.sizes[next] += s;                          // the next room's own size grows; the last one takes the rest
        node.sizes.splice(i, 1);
      } else if (i < last) { node.sizes[prev] += s; node.sizes.splice(i, 1); }   // the room before it takes its size
      else node.sizes.splice(last - 1, 1);                               // last part: the one before becomes the last and takes what is left
      node.kids.splice(i, 1);
    }
    return node.kids.length === 1 ? node.kids[0] : node;
  };
  const p = clone(plan);
  p.tree = go(p.tree);
  return p;
}

// ---------------------------------------------------------------- less open space than the standard
/**
 * When the visitor asks for less open space than the standard on a side (no gap at the sides, 3 ft at the back), the model
 * draws a bigger plot, whose standard open space is trimmed down to what was asked. Returns the plot to draw and the feet
 * to trim off each side, or null when nothing is below the standard.
 */
export function outsetFor(W, D, own) {
  if (!own) return null;
  const want = (k) => (Number.isFinite(own[k]) ? own[k] : null);
  const rs = ruleFor(W, D);
  const less = (k) => want(k) != null && want(k) < rs[k] - 0.01;
  if (!less('side') && !less('front') && !less('rear')) return null;
  if ((want('side') != null && want('side') > rs.side + 0.01) || (want('front') != null && want('front') > rs.front + 0.01)
    || (want('rear') != null && want('rear') > rs.rear + 0.01)) return null;        // asked for more somewhere else: that case is the inset
  // one pass against the standard of the real plot; the bigger plot must stay in the same size class (same standard open space)
  const cut = { s: want('side') != null ? Math.max(0, rs.side - want('side')) : 0, f: want('front') != null ? Math.max(0, rs.front - want('front')) : 0,
    r: want('rear') != null ? Math.max(0, rs.rear - want('rear')) : 0 };
  const w = Math.round(W + 2 * cut.s), d = Math.round(D + cut.f + cut.r);
  const rb = ruleFor(w, d);
  if (rb.side !== rs.side || rb.front !== rs.front || rb.rear !== rs.rear) return null;
  return { w, d, l: cut.s, r: cut.s, f: cut.f, b: cut.r };
}

/**
 * The visitor's own open space on any mix of sides: more than the standard in front, less on the sides, and so on. The model draws a
 * plot of a different size (smaller where open space is added, bigger where it is taken away) and the drawing is then trimmed and/or
 * wrapped so that every side ends up at exactly the distance asked. -> { w, d, es, ef, er } (the inner plot; the extra open space per
 * side, negative where open space is taken away) or null when nothing differs from the standard or no such plot can be drawn.
 */
export function reshapeFor(W, D, own) {
  if (!own) return null;
  const want = (k) => (Number.isFinite(own[k]) ? own[k] : null);
  if (!['side', 'front', 'rear'].some((k) => want(k) != null)) return null;
  let w = W, d = D, es = 0, ef = 0, er = 0;
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    const rl = ruleFor(w, d);
    es = want('side') != null ? want('side') - rl.side : 0;
    ef = want('front') != null ? want('front') - rl.front : 0;
    er = want('rear') != null ? want('rear') - rl.rear : 0;
    const nw = Math.round(W - 2 * es), nd = Math.round(D - ef - er);
    if (nw === w && nd === d) break;
    const key = nw + 'x' + nd;
    if (seen.has(key)) break;                                          // the size class flips back and forth: settle on this one
    seen.add(key);
    w = nw; d = nd;
  }
  const rl = ruleFor(w, d);
  es = want('side') != null ? want('side') - rl.side : 0;
  ef = want('front') != null ? want('front') - rl.front : 0;
  er = want('rear') != null ? want('rear') - rl.rear : 0;
  if (Math.abs(es) < 0.01 && Math.abs(ef) < 0.01 && Math.abs(er) < 0.01 && w === W && d === D) return null;
  if (Math.abs(W - 2 * es - w) > 0.51 || Math.abs(D - ef - er - d) > 0.51) return null;        // does not close: leave it to the checker
  if (w < 18 || d < 30) return null;
  return { w, d, es, ef, er };
}

/** How much open space a tree plan really leaves round its built box: { l, r, f, b } (the model does not always draw the standard). */
function marginsOf(plan) {
  const built = rooms(plan).filter((r) => !OPEN.has(r.t) && r.t !== 'bath');
  if (!built.length) return null;
  return {
    l: Math.min(...built.map((r) => r.x)), r: plan.plot.w - Math.max(...built.map((r) => r.x + r.w)),
    f: Math.min(...built.map((r) => r.y)), b: plan.plot.d - Math.max(...built.map((r) => r.y + r.d)),
  };
}

/** Make a tree plan wider or deeper by `amt` (negative: narrower) by growing (shrinking) the biggest room of every row, never the open strips. */
function stretch(plan, axis, amt) {
  if (Math.abs(amt) < 0.01) return;
  const builtKid = (n) => (n.k === 'room' ? !OPEN.has(n.t) && n.t !== 'bath' : n.kids.some(builtKid));
  const go = (node, total) => {
    if (node.k === 'room') return;
    const along = (node.k === 'V') === (axis === 'x');
    const sizes = [...node.sizes, total - node.sizes.reduce((a, v) => a + v, 0)], last = node.kids.length - 1;
    if (!along) {                                                       // across: every part spans the whole extent, so every part stretches
      node.kids.forEach((k, i) => go(k, total + amt));
      return;
    }
    const hasB = node.kids.some(builtKid);
    const cand = sizes.map((_, i) => i).filter((i) => (hasB ? builtKid(node.kids[i]) : true));
    const idx = cand.reduce((a, i) => (sizes[i] > sizes[a] ? i : a), cand[0]);
    if (idx < last) node.sizes[idx] = Math.round((node.sizes[idx] + amt) * 100) / 100;
    go(node.kids[idx], sizes[idx] + amt);
  };
  go(plan.tree, axis === 'x' ? plan.plot.w : plan.plot.d);
}

/**
 * Draw a plan made for the inner plot of reshapeFor onto the real plot W x D. Every side the visitor named is set to exactly the open
 * space asked for, judged from what the plan really leaves (not the standard): open space that is too much is trimmed off, open space that
 * is too little is wrapped round, and whatever is left over in the plot size is taken up by the rooms. own: { side, front, rear } in feet.
 */
export function applyReshape(plan, W, D, rs, own) {
  const want = (k) => (Number.isFinite(own && own[k]) ? own[k] : null);
  const m = marginsOf(plan);
  if (!m) return plan;
  const target = { l: want('side'), r: want('side'), f: want('front'), b: want('rear') };
  const dl = {};
  for (const k of ['l', 'r', 'f', 'b']) dl[k] = target[k] == null ? 0 : Math.round((target[k] - m[k]) * 2) / 2;
  const cut = { l: Math.max(0, -dl.l), r: Math.max(0, -dl.r), f: Math.max(0, -dl.f), b: Math.max(0, -dl.b) };
  const add = { l: Math.max(0, dl.l), r: Math.max(0, dl.r), f: Math.max(0, dl.f), b: Math.max(0, dl.b) };
  let q = plan;
  const w0 = plan.plot.w, d0 = plan.plot.d;
  if (cut.l + cut.r + cut.f + cut.b > 0.001) q = trimGround(q, w0 - cut.l - cut.r, d0 - cut.f - cut.b, { w: w0, d: d0, ...cut }, true);
  const w1 = q.plot.w, d1 = q.plot.d;
  // the open space asked for (or the plot's standard on a side not named) is kept to the foot: when the plan comes out a little too big
  // for the plot, the rooms take the difference (stretch below), not the open space
  if (add.l + add.r + add.f + add.b > 0.001) q = wrapGround(q, w1 + add.l + add.r, d1 + add.f + add.b, { w: w1, d: d1, l: add.l, r: add.r, f: add.f, b: add.b });
  const mw = q.plot.w - W, md = q.plot.d - D;
  if (Math.abs(mw) > 6.01 || Math.abs(md) > 6.01) throw new Error(`size mismatch ${mw} x ${md}`);       // the rooms take up to 6 ft of difference
  q = clone(q);
  stretch(q, 'x', -mw);
  stretch(q, 'y', -md);
  q.plot = { w: W, d: D };
  return q;
}

/**
 * Trim the outer open strips of a tree plan drawn for a bigger plot, so it fits the real plot (W x D). o: { w, d } the size it was
 * drawn for, { l, r, f, b } how much open space goes from the left, right, front and back. Every row (or column) gives the amount up from
 * its own open strips (void or lawn), the one at the edge first; a strip that is used up is taken out. The front row, which holds the car
 * porch, may also get shallower down to 9.5 ft. Throws when a side has nothing to give (the caller then skips that draft).
 */
export function trimGround(plan, W, D, o, lenient = false) {
  if (!plan.tree) return plan;
  const p = clone(plan);
  const EPS = 0.05;
  const isStrip = (n) => n.k === 'room' && (n.t === 'void' || n.t === 'lawn');
  const allStrip = (n) => isStrip(n) || (n.k !== 'room' && n.kids.every(allStrip));
  const allOpen = (n) => (n.k === 'room' ? n.t === 'void' || n.t === 'lawn' || n.t === 'porch' : n.kids.every(allOpen));
  const hasPorch = (n) => (n.k === 'room' ? n.t === 'porch' : n.kids.some(hasPorch));
  const sizesOf = (node, total) => [...node.sizes, total - node.sizes.reduce((a, v) => a + v, 0)];
  /** Take `amt` along the split axis of `node` (total = its extent along it) from its strips: the edge one first. */
  const cutAlong = (node, side, amt, total) => {
    let left = amt;
    const start = side === 'l' || side === 'f';
    for (let guard = 0; guard < 12 && left > EPS; guard++) {
      const n = node.kids.length, sz = sizesOf(node, total);
      const order = [...node.kids.keys()].sort((x, y) => (start ? x - y : y - x));
      let idx = order.find((i) => allStrip(node.kids[i]) && sz[i] > EPS);
      let floor = 0;
      if (idx === undefined) {                                           // no strip: the front row of open space and the car porch may get shallower
        idx = order.find((i) => (side === 'f' || side === 'b') && allOpen(node.kids[i]) && sz[i] - (hasPorch(node.kids[i]) ? 9.5 : 0.5) > EPS);
        if (idx === undefined) { if (lenient && (side === 'f' || side === 'b')) break; throw new Error('cannot trim'); }
        floor = hasPorch(node.kids[idx]) ? 9.5 : 0.5;
      }
      const take = Math.min(left, sz[idx] - floor);
      const last = n - 1;
      if (floor === 0 && sz[idx] - take < EPS) {                         // the strip is used up: take it out
        if (idx === last) { node.kids.pop(); node.sizes.pop(); } else { node.kids.splice(idx, 1); node.sizes.splice(idx, 1); }
      } else if (idx < last) node.sizes[idx] = Math.round((node.sizes[idx] - take) * 100) / 100;
      total -= take; left -= take;
    }
    if (left > EPS && !lenient) throw new Error('strip too thin');
  };
  /** Take `amt` off one side of `node` (W x D now). */
  const trimSide = (node, side, amt, w, d) => {
    if (amt < EPS) return;
    if (node.k === 'room') { if (!isStrip(node)) throw new Error('cannot trim'); return; }   // a strip leaf shrinks with the parent
    const alongX = side === 'l' || side === 'r';
    if ((node.k === 'V') === alongX) { cutAlong(node, side, amt, alongX ? w : d); return; }
    const sz = sizesOf(node, node.k === 'V' ? w : d);                  // across the split axis: every part spans the whole side
    node.kids.forEach((k, i) => (node.k === 'V' ? trimSide(k, side, amt, sz[i], d) : trimSide(k, side, amt, w, sz[i])));
  };
  let w = o.w, d = o.d;
  try {
    for (const [side, amt] of [['l', o.l], ['r', o.r], ['f', o.f], ['b', o.b]]) {
      trimSide(p.tree, side, amt, w, d);
      if (side === 'l' || side === 'r') w -= amt; else d -= amt;
    }
  } catch (e) { if (typeof window !== 'undefined' && window.__S) console.log('[trim tree]', e.message, JSON.stringify(plan.tree)); throw e; }
  p.tree = collapse(p.tree);
  p.plot = { w: W, d: D };
  return p;
}

// ---------------------------------------------------------------- standard stairs and car porch size
const SNAP5 = (v) => Math.round(v * 2) / 2;
export const carsFit = (w) => (w >= 25.5 ? 3 : w >= 17.5 ? 2 : w >= 9.5 ? 1 : 0);   // cars that fit side by side in a porch this wide
const PORCH_W = [10, 18, 26];                                                       // width wanted for 1, 2, 3 cars

/** The first leaf of a tree plan that passes `pred`: { leaf, x, y, w, d, chain: [{ node, i, x, y, w, d }] } (chain: its cuts, root first). */
function locate(plan, pred) {
  let found = null;
  const go = (node, x, y, w, d, chain) => {
    if (found) return;
    if (node.k === 'room') { if (pred(node)) found = { leaf: node, x, y, w, d, chain }; return; }
    const total = node.k === 'H' ? d : w;
    const parts = [...node.sizes, total - node.sizes.reduce((a, b) => a + b, 0)];
    let pos = 0;
    parts.forEach((s, i) => {
      const c = [...chain, { node, i, x, y, w, d, parts }];
      if (node.k === 'H') go(node.kids[i], x, y + pos, w, s, c); else go(node.kids[i], x + pos, y, s, d, c);
      pos += s;
    });
  };
  go(plan.tree, 0, 0, plan.plot.w, plan.plot.d, []);
  return found;
}

/** Move `delta` feet (>0 shrinks) of kid i of a cut over to kid j. */
function moveSize(node, parts, i, j, delta) {
  const p = parts.slice();
  p[i] -= delta; p[j] += delta;
  node.sizes = p.slice(0, -1).map((v) => Math.round(v * 100) / 100);
}
const minLeaf = (n) => (n.k !== 'room' ? 7 : n.t === 'passage' || n.t === 'lobby' ? 3.5 : n.t === 'void' || n.t === 'lawn' || n.t === 'porch' ? 3 : 7);

/** Change the size of the leaf found by `f` along one axis ('V' = its width, 'H' = its depth) to `target`, the difference going to / coming
 *  from its neighbours in the nearest cut of that axis. Returns the size reached. */
function resizeLeaf(plan, f, axis, target, skip = () => false) {
  const link = [...f.chain].reverse().find((c) => c.node.k === axis);
  if (!link) return axis === 'V' ? f.w : f.d;
  const { node, i, parts } = link;
  const cur = parts[i], delta = target - cur;                       // delta > 0: grow
  if (Math.abs(delta) < 0.01) return cur;
  const order = [i - 1, i + 1].filter((j) => j >= 0 && j < parts.length && !skip(node.kids[j]))
    .sort((a, b) => (OPEN.has(node.kids[a].t) ? 1 : 0) - (OPEN.has(node.kids[b].t) ? 1 : 0));   // rooms give / take before open strips
  let left = Math.abs(delta), done = 0;
  const work = parts.slice();
  for (const j of order) {
    if (left < 0.01) break;
    const room = delta > 0 ? Math.max(0, work[j] - minLeaf(node.kids[j])) : Infinity;
    const take = Math.min(left, room);
    if (take <= 0) continue;
    work[j] += delta > 0 ? -take : take; work[i] += delta > 0 ? take : -take;
    left -= take; done += take;
  }
  node.sizes = work.slice(0, -1).map((v) => Math.round(v * 100) / 100);
  return cur + (delta > 0 ? done : -done);
}

/** Stairs the way a house is built. A house with a first floor gets a proper turning stair (two flights side by side, a landing between, nine
 *  steps of 7 in in each) in a room of 7 x 13.5 ft, or a smaller one (down to 5.5 x 12 ft, flights of 2.5 ft) when the house is small or the
 *  rooms beside it cannot give that much; with `strict` a draft that cannot get one is refused (thrown). Otherwise (the last resort) a straight
 *  flight is 3.5 to 4 ft wide and up to 18 ft long; what the model drew beyond that goes back to the room beside it. Ground floors only. */
export function standardStairs(plan, strict = false) {
  if (!plan.tree || plan.floor) return plan;
  const two = (plan.storeys || 1) >= 2;
  if (two) {                                                          // a house with a first floor gets a proper turning stair, in a room of its own size taken from the rooms around
    const best = turningStairRoom(plan);
    if (best) return best;
    if (strict) throw new Error('the rooms beside the stairs cannot give room for a proper stair');      // strict: this draft is skipped (a straight stair in this little room is steep)
  }
  const p = clone(plan);
  const f = locate(p, (n) => n.t === 'stairs');
  if (!f) return p;
  const wide = f.w >= f.d ? 'V' : 'H';                               // the stair runs along its longer side; the other is its width
  const [short, long] = wide === 'V' ? [f.d, f.w] : [f.w, f.d];
  const shortAxis = wide === 'V' ? 'H' : 'V', longAxis = wide === 'V' ? 'V' : 'H';
  if (long >= 9 && short > 4) resizeLeaf(p, f, shortAxis, 4);   // a straight stair room is 4 ft wide at most (the model sometimes draws one 7 or 8 ft wide)
  if (long > 18) {
    const g = locate(p, (n) => n.t === 'stairs');
    resizeLeaf(p, g, longAxis, 17.5);
  } else if (two && long < 15.5) {                                    // a straight stair up to a first floor needs the length for its steps (16 treads of 10 in and the strip at each door)
    const q = clone(p), g = locate(q, (n) => n.t === 'stairs'), m0 = marginsOf(p);
    resizeLeaf(q, g, longAxis, 16, (k) => k.k === 'room' && OPEN.has(k.t));
    const m1 = marginsOf(q);
    if (!m0 || !m1 || ['l', 'r', 'f', 'b'].every((k) => m1[k] >= m0[k] - 0.05)) return q;
  }
  return p;
}

/** The stairs of a two-storey house as a proper turning stair (two flights side by side, a landing between): the room is brought to
 *  STAIR_ROOM, or to one of the smaller proper sizes when the rooms beside it cannot spare that much, the difference taken from / given
 *  to them. The room always runs along the depth of the plot; null when even the smallest does not fit (the straight stair is then the
 *  fallback). */
const STAIR_TIERS = [[STAIR_ROOM.wid, STAIR_ROOM.len, 1000], [7, 13, 850], [6.5, 12.5, 750], [6, 12.5, 650], [5.5, 12, 0]];     // [width, length, smallest built area it is drawn in]: flights down to 2.5 ft, so a small house gets a smaller proper stair, never the long straight one
function turningStairRoom(plan) {
  const f0 = locate(plan, (n) => n.t === 'stairs');
  if (!f0) return null;
  const m0 = marginsOf(plan), isOpen = (k) => k.k === 'room' && OPEN.has(k.t);     // the open space round the house, the lawn and the porch are not given up for the stairs
  const area = m0 ? (plan.plot.w - m0.l - m0.r) * (plan.plot.d - m0.f - m0.b) : Infinity;      // the house's footprint: the stair takes a smaller share of a small house
  for (const [wid, len, minArea] of STAIR_TIERS) {
    if (area < minArea) continue;
    let best = null;
    for (const long of ['H']) {                                       // the room runs along the depth of the plot, like the stairs the first-floor model has seen
      const short = 'V';
      const p = clone(plan);
      resizeLeaf(p, locate(p, (n) => n.t === 'stairs'), short, wid, isOpen);
      resizeLeaf(p, locate(p, (n) => n.t === 'stairs'), long, len, isOpen);
      const c = locate(p, (n) => n.t === 'stairs');
      const m1 = marginsOf(p);
      if (m0 && m1 && ['l', 'r', 'f', 'b'].some((k) => m1[k] < m0[k] - 0.05)) continue;     // the house must not grow into its open space
      if (!turningStair({ w: c.w, d: c.d })) continue;
      const off = Math.abs(Math.min(c.w, c.d) - wid) + Math.abs(Math.max(c.w, c.d) - len);
      if (!best || off < best.off) best = { p, off };
    }
    if (best) return best.p;
  }
  return null;
}

/** A first floor drafted over a narrow stair (the model is shown 4 ft wide, which it has seen often) gets the stair room of the ground floor:
 *  the stair leaf grows to `R` ({x, y, w, d} in the box) into the rooms beside it, which give up the width. Throws when they cannot, so the
 *  draft is skipped. The plan's `up` is then R, as the rule checker expects the stairs to stand exactly where the stairs below are. */
export function growUpperStairs(plan, R) {
  if (!plan.tree || !plan.box || !plan.up) return plan;
  const n = plan.up, near = (a, b) => Math.abs(a - b) < 0.011;
  if (near(n.x, R.x) && near(n.y, R.y) && near(n.w, R.w) && near(n.d, R.d)) return plan;
  const g = [n.x - R.x, R.x + R.w - (n.x + n.w), n.y - R.y, R.y + R.d - (n.y + n.d)];
  if (g.some((v) => v < -0.011)) throw new Error('the stairs are bigger than the stair room');
  const p = clone(plan);
  const grow = (axis, g0, g1) => {                                    // axis 'V': across the plot, 'H': along its depth
    if (g0 < 0.011 && g1 < 0.011) return;
    const f = locate(p, (k) => k.t === 'stairs');
    const link = f && [...f.chain].reverse().find((c) => c.node.k === axis);
    if (!link) throw new Error('no cut to grow the stairs in');
    const { node, i, parts } = link, work = parts.slice();
    if (g0 > 0.011) { if (i < 1 || work[i - 1] - g0 < minLeaf(node.kids[i - 1])) throw new Error('no room beside the stairs'); work[i - 1] -= g0; work[i] += g0; }
    if (g1 > 0.011) { if (i > work.length - 2 || work[i + 1] - g1 < minLeaf(node.kids[i + 1])) throw new Error('no room beside the stairs'); work[i + 1] -= g1; work[i] += g1; }
    node.sizes = work.slice(0, -1).map((v) => Math.round(v * 100) / 100);
  };
  grow('V', g[0], g[1]); grow('H', g[2], g[3]);
  p.up = { x: R.x, y: R.y, w: R.w, d: R.d };
  return p;
}

/** A car porch wide enough for `cars` cars (10 ft for one, 18 for two, 26 for three), as far as the neighbouring rooms can give. */
export function sizePorch(plan, cars) {
  if (!plan.tree || plan.floor || !(cars >= 1)) return plan;
  const p = clone(plan);
  const f = locate(p, (n) => n.t === 'porch');
  if (!f) return p;
  const want = PORCH_W[Math.min(3, cars) - 1];
  if (f.w < want) resizeLeaf(p, f, 'V', want);
  return p;
}

// ---------------------------------------------------------------- rooms the visitor leaves out, lawn as car porch, terrace size, drawing room upstairs
const hasType = (n, t) => (n.k === 'room' ? n.t === t : n.kids.some((k) => hasType(k, t)));
/** A cut left with one part is that part. */
function collapse(node) {
  if (node.k === 'room') return node;
  node.kids = node.kids.map(collapse);
  return node.kids.length === 1 ? node.kids[0] : node;
}
/** No washroom in the drawing room: it is taken out and the drawing room keeps the whole space. */
export function dropGuestBath(plan) {
  if (!plan.tree) return plan;
  const p = clone(plan);
  const f = locate(p, (n) => n.t === 'drawing' && n.bath);
  if (!f) return plan;
  delete f.leaf.bath;
  return p;
}
/** Leave a room out: its neighbour (a room before an open strip, never the stairs) takes its space. Returns the plan unchanged when there is no such room. */
export function dropRoom(plan, type) {
  if (!plan.tree) return plan;
  const p = clone(plan);
  const f = locate(p, (n) => n.t === type);
  const link = f && f.chain[f.chain.length - 1];
  if (!link) return plan;
  const { node, i, parts } = link;
  const ok = (j) => j >= 0 && j < parts.length && !hasType(node.kids[j], 'stairs');
  const cand = [i + 1, i - 1].filter(ok).sort((a, b) => (OPEN.has(node.kids[a].t) ? 1 : 0) - (OPEN.has(node.kids[b].t) ? 1 : 0));
  if (!cand.length) return plan;
  const j = cand[0], np = parts.slice();
  np[j] += np[i]; np.splice(i, 1); node.kids.splice(i, 1);
  if (type === 'drawing') p.noDrawing = true;                          // the visitor asked for no drawing room: the rule that wants one is lifted
  node.sizes = np.slice(0, -1).map((v) => Math.round(v * 100) / 100);
  p.tree = collapse(p.tree);
  return p;
}

/** No lawn: the lawn beside the car porch becomes car porch too, so the whole front strip is one open porch for the cars. */
export function lawnToPorch(plan) {
  if (!plan.tree) return plan;
  const p = clone(plan);
  let did = false;
  const go = (node) => {
    if (node.k === 'room') return;
    node.kids.forEach(go);
    if (!node.kids.some((k) => k.k === 'room' && k.t === 'porch') || !node.kids.some((k) => k.k === 'room' && k.t === 'lawn')) return;
    node.kids = node.kids.map((k) => (k.k === 'room' && k.t === 'lawn' ? { k: 'room', t: 'porch' } : k));
    for (let g = 0; g < 6; g++) {
      const i = node.kids.findIndex((k, a) => k.t === 'porch' && node.kids[a + 1] && node.kids[a + 1].t === 'porch');
      if (i < 0) break;
      const last = node.kids.length - 1;
      if (i + 1 < last) node.sizes[i + 1] += node.sizes[i];
      node.sizes.splice(i, 1); node.kids.splice(i + 1, 1);
    }
    did = true;
  };
  go(p.tree);
  if (!did) return plan;
  p.tree = collapse(p.tree);
  return p;
}

/** A first floor's terrace made `k` times as deep (the thinner side of it), as far as the rooms beside it can give or take. */
export function scaleTerrace(plan, k) {
  if (!plan.tree || Math.abs(k - 1) < 0.05) return plan;
  const p = clone(plan);
  const f = locate(p, (n) => n.t === 'terrace');
  if (!f) return plan;
  const axis = f.w >= f.d ? 'H' : 'V', cur = axis === 'H' ? f.d : f.w;
  const target = Math.max(5, SNAP5(cur * k));
  resizeLeaf(p, f, axis, target, (n) => hasType(n, 'stairs'));
  return p;
}

/** A drawing room on the first floor: the study becomes it; failing that a smaller terrace is made and part of it built over as the drawing room
 *  (mode 'terrace' does only that, so the family lounge stays); failing that the family lounge is made the drawing room. */
export function upperDrawing(plan, mode = 'auto') {
  if (!plan.tree || hasType(plan.tree, 'drawing')) return plan;
  const p = clone(plan);
  const study = mode === 'auto' && locate(p, (n) => n.t === 'study');
  if (study) { study.leaf.t = 'drawing'; p.upDrawing = true; return p; }
  const t = locate(p, (n) => n.t === 'terrace');
  if (t && t.w * t.d >= 130) {                                          // room for a drawing room of about 10 x 12 ft and still a terrace of 5 ft or more
    const alongW = t.w >= t.d;                                          // cut across the longer side
    const long = alongW ? t.w : t.d, short = alongW ? t.d : t.w;
    if (short >= 10 && long >= 16) {
      const dr = Math.max(11, Math.min(long - 5, Math.round(long * 0.58 * 2) / 2));
      t.leaf.k = alongW ? 'V' : 'H';
      t.leaf.kids = [{ k: 'room', t: 'drawing' }, { k: 'room', t: 'terrace' }];
      t.leaf.sizes = [dr];
      delete t.leaf.t;
      p.upDrawing = true;
      return p;
    }
  }
  if (mode === 'terrace') return plan;
  const f = locate(p, (n) => n.t === 'lounge');
  if (!f) return plan;
  f.leaf.t = 'drawing';
  p.upDrawing = true;                                                  // the rule that keeps the drawing room downstairs is lifted for it
  return p;
}

/**
 * A first floor stands on the ground floor's walls: its built outline is the ground floor's box. Polishing can pull an edge
 * a few inches in (a 3 ft sliver of open air where the wall should be), so the open strips around the box are put back to
 * the box's own size; the rooms inside grow into it (the last part of every cut takes the rest).
 */
export function refitBox(plan, box) {
  if (!plan.tree || !box) return plan;
  const p = clone(plan), { w: W, d: D } = plan.plot;
  const peel = (node, k, before, size, total) => {
    const after = total - before - size, lead = before > 0.01, tail = after > 0.01;
    if (!lead && !tail) return node;
    const isVoid = (n) => n && n.k === 'room' && (n.t === 'void' || n.t === 'lawn');
    if (node.k !== k || node.kids.length !== 1 + lead + tail) return null;
    if (lead && !isVoid(node.kids[0])) return null;
    if (tail && !isVoid(node.kids[node.kids.length - 1])) return null;
    node.sizes = lead ? (tail ? [before, size] : [before]) : [size];
    return node.kids[lead ? 1 : 0];
  };
  const h = peel(p.tree, 'H', box.y, box.d, D);
  if (!h) return plan;
  if (!peel(h, 'V', box.x, box.w, W)) return plan;
  return p;
}

// ---------------------------------------------------------------- washrooms of different shapes
/**
 * Washrooms that are not all the same box. The model draws nearly every attached washroom about 4.5 x 6.5 ft; real plans
 * have long narrow ones (3.5 x 9: a bedroom keeps a wide wall) and squarer ones (5.5 x 5.5: a short bedroom keeps its depth).
 * Each washroom is redrawn with the same floor area in another shape that still fits its room and keeps the rooms useful:
 * the shape is chosen from the room's own proportions (a long room takes a narrow washroom along its wall; a squarish one
 * a squarer washroom) and, so that neighbours differ, rotated through the candidates by the washroom's place in the plan.
 */
export function varyBaths(plan, salt = 0) {
  if (!plan.tree) return plan;
  const list = rooms(plan).filter((r) => r.node.bath);
  if (!list.length) return plan;
  const p = clone(plan), mine = rooms(p).filter((r) => r.node.bath);
  mine.forEach((r, n) => {
    const [bw, bd] = r.node.bath, A = bw * bd, longRoom = r.d >= r.w * 1.15;
    const cand = [];
    for (let w = 3.5; w <= 6.5; w += 0.5) {
      const d = Math.round((A / w) * 2) / 2, area = w * d;
      if (w > r.w - 1 || d > r.d - 2 || d < 5 || Math.abs(area - A) / A > 0.1 || Math.max(w, d) / Math.min(w, d) > 2.7) continue;
      cand.push([w, d]);
    }
    if (cand.length < 2) return;
    cand.sort((a, b) => a[0] - b[0]);                                // narrow and long first, squarer last
    const k = longRoom ? [0, 1, 0, Math.floor(cand.length / 2)] : [cand.length - 1, Math.floor(cand.length / 2), 0, cand.length - 1];
    const [w, d] = cand[Math.min(cand.length - 1, k[(n + salt) % k.length])];
    r.node.bath = [w, d, r.node.bath[2]];
  });
  return p;
}
