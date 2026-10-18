// Small changes to one part of a drafted plan, leaving the rest alone: the car porch (an open space swapped with the lawn
// beside it) and a balcony in front of the first floor. Each returns a changed copy of the plan, or null when the plan
// has no room for the change. The checker and the drawing then work from the changed plan as usual.
import { OPEN } from './bands.js';

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
