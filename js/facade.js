// The front of the house, composed the way houses in Bahria Town and DHA are: not a flat wall with windows, but a few
// strong pieces in front of it. Three compositions, each in the materials of the chosen style:
//   frame  a double-height frame round the entrance, clad inside, with a screen of timber fins on the blank wall upstairs
//   tower  a tall stone-clad feature wall at one side, rising past the parapet, with a dark slit beside it and a long canopy
//   bands  a "C" of floating slabs: one at the first floor, one at the roof, joined by a side wall, timber between the windows
// All three box the upstairs windows in deep frames, put a pergola edge on the car porch and lights on the gate pillars.
// Everything here stands in front of the walls the plan gives: no room, door or window is moved.
import * as THREE from 'three';

export const FACADES = { frame: 'Entrance frame', tower: 'Feature wall', bands: 'Floating slabs', plain: 'Plain' };
const AUTO = { modern: 'frame', box: 'bands', classic: 'frame', colonial: 'bands', spanish: 'tower', haveli: 'tower' };
export const facadeFor = (styleId, choice) => (choice && choice !== 'auto' && FACADES[choice] ? choice : AUTO[styleId] || 'frame');

/**
 * c: { box, world, upperG, roofG, L, U, B, st, site, H, STOREY, SLAB, mainDoor, porch, carportAtFront, adj(opening), mats: { mTrim, mAccent, mFrame, mStone, mSlats, mExt, mConcrete, mat }, gate: { lo, hi, top } }
 * -> { portico: false when the composition has its own cover over the door }
 */
export function buildFacade(c, comp) {
  const { box, L, U, B, st, H, STOREY, SLAB, mainDoor: door, mats } = c;
  const { mTrim, mAccent, mFrame, mStone, mSlats, mat } = mats;
  if (comp === 'plain') return { portico: true };
  const fam = st.family;
  const UB = U ? U.B : null, flush = !!UB && Math.abs(UB.z - B.z) < 0.5;        // the first floor's front wall stands on the ground floor's
  const face = B.z - 0.375, wallTop = (U ? STOREY : 0) + H, roofTop = wallTop + SLAB + 2.6, split = U ? STOREY - 0.55 : Infinity;
  const mFeature = fam === 'modern' ? mTrim : fam === 'classic' ? mTrim : mAccent;                 // the frame and the slabs
  const mClad = fam === 'modern' ? mSlats : mStone;                                                 // what fills the frame: timber on a modern front, stone on the others
  const mFin = fam === 'classic' ? mAccent : mSlats;
  const mLamp = new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffd890', emissiveIntensity: 1.3 });

  // a piece of the front, cut where the storeys meet so each part hides with its storey (ground / first floor / above the walls)
  const put = (x0, x1, y0, y1, z0, z1, m, collide = false) => {
    for (const [a, b, parent] of [[y0, Math.min(y1, split), c.world], [Math.max(y0, split), Math.min(y1, wallTop), U ? c.upperG : c.world], [Math.max(y0, wallTop), y1, c.roofG]]) {
      if (b - a > 0.02) box(parent, x0, x1, a, b, z0, z1, m, collide && parent === c.world);
    }
  };
  // windows and doors in the front wall, as rectangles (x0, x1, y0, y1) with the surround they already have
  const holes = [];
  for (const [lay, dy, zc] of [[L, 0, B.z], ...(flush ? [[U, STOREY, UB.z]] : [])]) {
    for (const p0 of lay.openings) {
      if (p0.o !== 'h' || Math.abs(p0.c - zc) > 0.06) continue;
      const p = p0.kind === 'window' ? c.adj(p0) : p0;
      holes.push(p.kind === 'window' ? { x0: p.at - p.w / 2 - 0.75, x1: p.at + p.w / 2 + 0.75, y0: dy + p.sill - 0.6, y1: dy + p.top + 0.7, win: p, dy, upper: dy > 0 }
        : { x0: p.at - p.w / 2 - 0.3, x1: p.at + p.w / 2 + 0.3, y0: dy, y1: dy + p.top + 0.3, upper: dy > 0 });
    }
  }
  /** A cladding panel over the wall from x0 to x1, left open at every window and door. */
  const clad = (x0, x1, y0, y1, depth, m) => {
    const hs = holes.filter((h) => h.x1 > x0 && h.x0 < x1 && h.y1 > y0 && h.y0 < y1).sort((a, b) => a.x0 - b.x0);
    let cur = x0;
    for (const h of hs) {
      const a = Math.max(h.x0, x0), b = Math.min(h.x1, x1);
      if (a > cur) put(cur, a, y0, y1, face - depth, face, m);
      if (h.y0 > y0) put(a, b, y0, Math.min(h.y0, y1), face - depth, face, m);
      if (h.y1 < y1) put(a, b, Math.max(h.y1, y0), y1, face - depth, face, m);
      cur = Math.max(cur, b);
    }
    if (x1 > cur) put(cur, x1, y0, y1, face - depth, face, m);
  };
  /** A deep frame round an upstairs window: two cheeks and a ledge that join the sunshade already over it. */
  const boxFrame = (h, depth = 1.5) => {
    const p = h.win, o0 = p.at - p.w / 2, o1 = p.at + p.w / 2, y0 = h.dy + p.sill, y1 = h.dy + p.top;
    put(o0 - 0.7, o0 - 0.38, y0 - 0.55, y1 + 0.62, face - depth, face, mFeature);
    put(o1 + 0.38, o1 + 0.7, y0 - 0.55, y1 + 0.62, face - depth, face, mFeature);
    put(o0 - 0.7, o1 + 0.7, y0 - 0.55, y0 - 0.27, face - depth, face, mFeature);
  };
  /** Free stretches of the first floor's front wall between x0 and x1 (no window in them). */
  const blankUp = (x0, x1) => {
    const hs = holes.filter((h) => h.upper && h.x1 > x0 && h.x0 < x1).sort((a, b) => a.x0 - b.x0), out = [];
    let cur = x0;
    for (const h of hs) { if (h.x0 - cur > 0.5) out.push([cur, h.x0]); cur = Math.max(cur, h.x1); }
    if (x1 - cur > 0.5) out.push([cur, x1]);
    return out.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  };
  /** A screen of upright timber fins in front of a blank stretch of wall. */
  const fins = (x0, x1, y0, y1) => {
    for (let x = x0 + 0.2; x < x1 - 0.2; x += 0.62) put(x, x + 0.2, y0, y1, face - 0.7, face - 0.08, mFin);
    put(x0, x1, y1 - 0.18, y1, face - 0.72, face - 0.06, mFeature); put(x0, x1, y0, y0 + 0.18, face - 0.72, face - 0.06, mFeature);
  };

  const left = B.x - 0.3, right = B.x + B.w + 0.3;
  const tall = flush && UB.x <= B.x + 0.6 && UB.x + UB.w >= B.x + B.w - 0.6;      // the first floor covers the whole front
  const top = tall ? roofTop : (U ? STOREY - 0.5 : H + SLAB + 2.6);                // how high the tall pieces may rise from the ground
  let portico = true;

  if (comp === 'frame') {
    // the frame round the entrance: two piers and a beam, standing proud of the wall, rising past the parapet
    const fx0 = Math.max(left, door.at - door.w / 2 - 2.6), fx1 = Math.min(right, door.at + door.w / 2 + 2.6), fz = face - 1.4, ft = top + 1.3;
    put(fx0, fx0 + 0.75, 0, ft, fz, face, mFeature, true); put(fx1 - 0.75, fx1, 0, ft, fz, face, mFeature, true);
    put(fx0, fx1, ft - 0.9, ft, fz, face, mFeature);
    clad(fx0 + 0.75, fx1 - 0.75, door.top + 0.5, ft - 0.9, 0.16, mClad);            // clad between the piers, above the door
    put(fx0 + 0.75, fx1 - 0.75, door.top + 0.55, door.top + 0.95, face - 3.2, face, mFeature);     // a canopy over the door, inside the frame
    portico = false;
    if (tall) {                                                    // upstairs: timber fins on the widest blank stretch, deep frames round the windows
      const free = blankUp(left + 0.4, right - 0.4).flatMap(([a, b]) => [[a, Math.min(b, fx0 - 0.3)], [Math.max(a, fx1 + 0.3), b]]).filter(([a, b]) => b - a >= 2.4).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
      if (free[0]) { const [a, b] = free[0], w = Math.min(b - a, 7.5), mid = (a + b) / 2; fins(mid - w / 2, mid + w / 2, STOREY + 0.4, wallTop - 0.2); }
    }
  } else if (comp === 'tower') {
    // the feature wall on the side away from the door: stone from the ground past the parapet, a dark slit beside it
    const onLeft = door.at > B.x + B.w / 2, tw = Math.max(6, Math.min(9, B.w * 0.3));
    const tx0 = onLeft ? left : right - tw, tx1 = tx0 + tw, tt = top + 2.2;
    clad(tx0, tx1, 0, tt, 0.7, mStone);
    put(tx0 - 0.15, tx1 + 0.15, tt, tt + 0.3, face - 0.85, face + 0.2, mFeature);
    const sx = onLeft ? tx1 + 0.25 : tx0 - 0.75;
    put(sx, sx + 0.5, 0.4, top - 0.4, face - 0.12, face, mFrame);                   // the slit: a recessed dark strip the height of the house
    // a long canopy from the feature wall across the door
    const cx0 = onLeft ? tx1 : Math.max(left, door.at - door.w / 2 - 2.2), cx1 = onLeft ? Math.min(right, door.at + door.w / 2 + 2.2) : tx0;
    if (!c.carportAtFront && cx1 - cx0 > 3) { put(cx0, cx1, door.top + 0.6, door.top + 1.0, face - 3.4, face, mFeature); portico = false; }
  } else if (comp === 'bands') {
    // the C: a slab at the first floor and a slab at the roof, joined at one side by a wall, all standing 2.2 ft proud
    const d = 2.2, onLeft = door.at > B.x + B.w / 2, yb = U ? STOREY - 0.75 : door.top + 0.6, yt = (tall || !U ? (U ? wallTop : H) + SLAB + 1.6 : STOREY - 0.75);
    if (tall || !U) {
      put(left - 0.2, right + 0.2, yt, yt + 0.55, face - d, face, mFeature);                                   // roof slab
      const wx = onLeft ? left - 0.2 : right - 0.5;
      put(wx, wx + 0.7, U ? yb : 0, yt, face - d, face, mFeature, !U);                                         // the side wall of the C
    }
    if (U) put(left - 0.2, right + 0.2, yb, yb + 0.5, face - d, face, mFeature);                                // first-floor slab
    if (tall) for (const [a, b] of blankUp(left + 1.2, right - 1.2).filter(([a, b]) => b - a >= 2).slice(0, 2)) clad(a + 0.2, b - 0.2, STOREY + 0.2, wallTop, 0.14, mClad);   // timber between the windows
    if (!U) clad(left + 1, right - 1, door.top + 1.2, H + SLAB + 1.6, 0.14, mClad);
    portico = !U ? false : portico;
  }
  // deep frames round the upstairs windows (round every front window of a single-storey house on the feature compositions)
  for (const h of holes) if (h.win && (h.upper || !U) && !(comp === 'bands' && !U)) boxFrame(h, comp === 'bands' ? 2.0 : 1.5);

  // the car porch: a pergola edge of slim beams beyond its roof, and lights under it
  if (c.carportAtFront && c.porch) {
    const p = c.porch, z0 = p.z;
    for (let x = p.x + 0.4; x < p.x + p.w - 0.3; x += 1.1) box(c.world, x, x + 0.28, 9.45, 9.95, z0 - 2.2, z0 + 0.3, mFin, false);
    box(c.world, p.x, p.x + p.w, 9.55, 9.9, z0 - 2.35, z0 - 2.1, mFeature, false);
    const zs = [z0 + (Math.min(p.z + p.d, B.z) - z0) * 0.3, z0 + (Math.min(p.z + p.d, B.z) - z0) * 0.72];
    for (const x of [p.x + p.w * 0.28, p.x + p.w * 0.72]) for (const z of zs) { const dl = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), mLamp); dl.rotation.x = Math.PI / 2; dl.position.set(x, 9.28, z); c.world.add(dl); }
  }
  // a lamp on each gate pillar
  if (c.gate) for (const x of [c.gate.lo - 0.4, c.gate.hi + 0.4]) { box(c.world, x - 0.28, x + 0.28, c.gate.top + 0.42, c.gate.top + 1.0, -0.28, 0.28, mLamp, false, false); box(c.world, x - 0.36, x + 0.36, c.gate.top + 1.0, c.gate.top + 1.1, -0.36, 0.36, mat('#2a2d30', { roughness: 0.5, metalness: 0.5 }), false, false); }
  return { portico };
}
