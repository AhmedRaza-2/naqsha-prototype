// Small changes to one part of a drafted plan, leaving the rest alone: the car porch (an open space swapped with the lawn
// beside it) and a balcony in front of the first floor. Each returns a changed copy of the plan, or null when the plan
// has no room for the change. The checker and the drawing then work from the changed plan as usual.
import { OPEN } from './bands.js';
import { ruleFor } from './layout.js';

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

/** Trim the outer open strips of a tree plan drawn for the bigger plot, so it fits the real plot (W x D). Throws when a strip is too thin. */
export function trimGround(plan, W, D, o) {
  if (!plan.tree) return plan;
  const p = clone(plan);
  const strip = (n) => n.k === 'room' && (n.t === 'void' || n.t === 'lawn');
  const walk = (node, cl, cr, cf, cb) => {
    if (cl + cr + cf + cb < 0.001) return;
    if (node.k === 'room') throw new Error('no strip to trim');
    const vert = node.k === 'V', last = node.kids.length - 1;
    const [a, z] = vert ? [cl, cr] : [cf, cb], [oa, oz] = vert ? [cf, cb] : [cl, cr];
    const total = (vert ? p.__w : p.__d);
    const sz = (i) => (i < last ? node.sizes[i] : total - node.sizes.reduce((s, v) => s + v, 0));
    let ra = a, rz = z;
    if (ra > 0 && strip(node.kids[0])) { if (sz(0) - ra < 0.5) throw new Error('strip too thin'); node.sizes[0] -= ra; ra = 0; }
    if (rz > 0 && strip(node.kids[last])) { if (sz(last) - rz < 0.5) throw new Error('strip too thin'); rz = 0; }
    const mid = node.kids.map((k, i) => i).filter((i) => !strip(node.kids[i]));
    const need = ra + rz + oa + oz;
    if (need < 0.001) return;
    if (mid.length !== 1) throw new Error('cannot trim');
    const j = mid[0], cut = ra + rz;
    if (cut > 0 && j < last) node.sizes[j] -= cut;
    const saveW = p.__w, saveD = p.__d;
    if (vert) p.__w = saveW - (a - ra) - (z - rz) - cut; else p.__d = saveD - (a - ra) - (z - rz) - cut;
    const kidArgs = vert ? [ra, rz, oa, oz] : [oa, oz, ra, rz];
    // the kid spans the (reduced) extent along this node's axis, and the full extent across it
    const w2 = vert ? saveW - (a - ra) - (z - rz) - cut : saveW, d2 = vert ? saveD : saveD - (a - ra) - (z - rz) - cut;
    p.__w = w2; p.__d = d2;
    walk(node.kids[j], ...kidArgs);
    p.__w = saveW; p.__d = saveD;
  };
  p.__w = o.w; p.__d = o.d;
  walk(p.tree, o.l, o.r, o.f, o.b);
  delete p.__w; delete p.__d;
  p.plot = { w: W, d: D };
  return p;
}
