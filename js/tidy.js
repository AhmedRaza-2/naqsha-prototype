// Tidying a drafted plan for how people actually live in small houses, without asking the model for anything new:
//   - plots under 10 marla get no separate entrance room: the front door opens into the drawing room (or the lounge), the way
//     most small Pakistani houses do, and the space of the entrance becomes part of that room;
//   - a single-storey house can drop its roof stairs: their room joins the neighbouring room.
// The plan the model wrote (and the rule checker saw) is kept as it is; the drawn layout merges the rooms, so the editor,
// the 3D walkthrough and the rule check all keep working on the same plan. plan.tidy = { entrance: true, stairs: false }.
import { OPEN } from './bands.js';

const near = (a, b) => Math.abs(a - b) < 0.011;
const touches = (r, o, c, lo, hi) => (o === 'v'
  ? r.x - 0.03 <= c && c <= r.x + r.w + 0.03 && r.y < hi && r.y + r.d > lo
  : r.y - 0.03 <= c && c <= r.y + r.d + 0.03 && r.x < hi && r.x + r.w > lo);

/** Rooms that share a whole side with `r` (same extent along the wall), with the wall they share. */
function fullNeighbours(r, mains) {
  const out = [];
  for (const n of mains) {
    if (n === r) continue;
    if (near(n.y, r.y) && near(n.d, r.d)) {
      if (near(n.x + n.w, r.x)) out.push({ n, o: 'v', c: r.x, lo: r.y, hi: r.y + r.d });
      else if (near(r.x + r.w, n.x)) out.push({ n, o: 'v', c: n.x, lo: r.y, hi: r.y + r.d });
    }
    if (near(n.x, r.x) && near(n.w, r.w)) {
      if (near(n.y + n.d, r.y)) out.push({ n, o: 'h', c: r.y, lo: r.x, hi: r.x + r.w });
      else if (near(r.y + r.d, n.y)) out.push({ n, o: 'h', c: n.y, lo: r.x, hi: r.x + r.w });
    }
  }
  return out;
}

/**
 * Merge every room of `type` into the best neighbour of one of the `prefer` types.
 * -> { rects, alias: [[removedIndex, keptIndex]], walls: [{ o, c, lo, hi }] } (the walls that no longer exist)
 */
export function mergeAway(rects, type, prefer, lockStairs = false) {
  let cur = rects.map((r) => ({ ...r }));
  const alias = [], walls = [], gone = [];
  for (let guard = 0; guard < 4; guard++) {
    const mains = cur.filter((r) => !OPEN.has(r.t) && r.parent === undefined && r.t !== 'bath');
    const target = mains.find((r) => r.t === type);
    if (!target) break;
    if (cur.some((b) => b.t === 'bath' && b.parent === target.i)) break;          // it has a washroom of its own: leave it
    let best = null;
    for (const f of fullNeighbours(target, mains)) {
      const rank = prefer.indexOf(f.n.t);
      if (rank < 0) continue;
      // the neighbour's own washroom must not sit against the wall that goes away
      if (cur.some((b) => b.t === 'bath' && b.parent === f.n.i && touches(b, f.o, f.c, f.lo, f.hi))) continue;
      if (!best || rank < best.rank) best = { ...f, rank };
    }
    if (!best) break;
    const n = best.n;
    const x0 = Math.min(n.x, target.x), y0 = Math.min(n.y, target.y), x1 = Math.max(n.x + n.w, target.x + target.w), y1 = Math.max(n.y + n.d, target.y + target.d);
    n.x = x0; n.y = y0; n.w = x1 - x0; n.d = y1 - y0;
    cur = cur.filter((r) => r !== target);
    gone.push({ i: target.i, rect: { x: target.x, y: target.y, w: target.w, d: target.d } });
    alias.push([target.i, n.i]);
    walls.push({ o: best.o, c: best.c, lo: best.lo, hi: best.hi });
  }
  return { rects: cur, alias, walls, gone };
}

/** Plots under 10 marla: no entrance room. Single-storey houses may also drop the roof stairs. */
export function tidyRects(rects, plan) {
  const t = plan.tidy || {};
  let out = { rects, alias: [], walls: [], gone: [] };
  const apply = (type, prefer) => {
    const r = mergeAway(out.rects, type, prefer, plan.storeys >= 2 || !!plan.floor);
    out = { rects: r.rects, alias: [...out.alias, ...r.alias], walls: [...out.walls, ...r.walls], gone: [...out.gone, ...r.gone] };
  };
  if (t.entrance) apply('lobby', plan.storeys >= 2 ? ['drawing', 'lounge', 'dining', 'passage'] : ['drawing', 'lounge', 'dining', 'passage', 'stairs']);
  if (t.stairs === false && !(plan.storeys >= 2) && !plan.floor) apply('stairs', ['lounge', 'passage', 'lobby', 'drawing', 'dining']);
  return out;
}
