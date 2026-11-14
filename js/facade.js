// The front of the house, composed the way houses in Bahria Town and DHA are: not a flat wall with windows, but a few
// strong pieces in front of it. A front is described by a small set of design choices (its "genes"):
//   entry    what stands at the door: a double-height frame, a canopy, or the style's own portico
//   wall     a tall feature wall at the side away from the door (stacked stone, timber or dark render), with or without a slit
//   slabs    floating slabs: at the first floor, at the roof, or both joined by a side wall into a "C"
//   fins     a screen of upright timber fins on the widest blank stretch upstairs
//   cladUp   timber or stone between the upstairs windows
//   win      how the front windows are framed: a deep box, an L (sunshade and one cheek), or only their sunshade
// plus sizes (how wide, how far out, how high past the parapet). Three named fronts are fixed sets of genes; "a new
// variation" draws the genes at random from a seed, under composition rules (one strong piece at least, never two that
// fight for the same stretch of wall, the feature wall opposite the door so the front balances), so every press gives
// another front that still makes sense. Everything stands in front of the walls the plan gives: no room, door or window moves.
import * as THREE from 'three';

export const FACADES = { frame: 'Entrance frame', tower: 'Feature wall', bands: 'Floating slabs', gen: 'A new variation', plain: 'Plain' };
const AUTO = { modern: 'frame', box: 'bands', classic: 'frame', colonial: 'bands', spanish: 'tower', haveli: 'tower' };
const PRESET = {
  frame: { entry: 'frame', wall: false, slabs: 'none', fins: true, cladUp: false, win: 'box', fill: 'auto', frameW: 2.6, proj: 1.4, rise: 1.3 },
  tower: { entry: 'canopy', wall: true, wallMat: 'stone', slit: true, slabs: 'none', fins: false, cladUp: false, win: 'box', wallW: 0.3, proj: 0.7, rise: 2.2 },
  bands: { entry: 'portico', wall: false, slabs: 'C', fins: false, cladUp: true, win: 'box', fill: 'auto', proj: 2.2, rise: 1.6 },
};
function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

/** The genes of a front. choice: 'auto' (the one that suits the style), a named front, 'gen' (drawn from `seed`) or 'plain' (null). */
export function facadeGenes(styleId, choice = 'auto', seed = 0) {
  const name = choice && choice !== 'auto' && FACADES[choice] ? choice : AUTO[styleId] || 'frame';
  if (name === 'plain') return null;
  if (name !== 'gen') return { ...PRESET[name], name };
  const r = rng(seed + styleId.length * 97 + styleId.charCodeAt(0)), pick = (a) => a[Math.floor(r() * a.length)], between = (a, b) => Math.round((a + r() * (b - a)) * 10) / 10;
  const g = { name: 'gen', entry: pick(['frame', 'frame', 'canopy', 'portico']) };
  g.wall = g.entry === 'frame' ? r() < 0.35 : r() < 0.65;
  g.wallMat = pick(['stone', 'stone', 'timber', 'dark']); g.slit = r() < 0.6; g.wallW = between(0.22, 0.34);
  g.slabs = pick(g.entry === 'frame' ? ['none', 'none', 'roof', 'band'] : ['none', 'roof', 'band', 'C', 'C']);
  if (g.wall && g.slabs === 'C') g.slabs = 'roof';                 // a feature wall and the side wall of a C would crowd the same corner
  g.fins = r() < 0.5; g.cladUp = !g.fins && r() < 0.55;
  g.win = pick(['box', 'box', 'L', 'none']);
  g.fill = pick(['timber', 'stone', 'auto']);
  g.frameW = between(2.1, 3.3); g.proj = between(g.slabs === 'none' ? 1.1 : 1.7, g.slabs === 'none' ? 1.6 : 2.4); g.rise = between(0.9, 2.6);
  if (g.entry !== 'frame' && !g.wall && g.slabs === 'none') g.slabs = 'C';       // at least one strong piece
  if (g.entry !== 'frame' && !g.wall && !g.fins && !g.cladUp) g.cladUp = true;    // and something on the wall itself
  return g;
}
export const facadeFor = (styleId, choice) => (choice && choice !== 'auto' && FACADES[choice] ? choice : AUTO[styleId] || 'frame');

/**
 * c: { box, world, upperG, roofG, L, U, B, st, site, H, STOREY, SLAB, mainDoor, porch, carportAtFront, adj(opening), mats: { mTrim, mAccent, mFrame, mStone, mSlats, mExt, mConcrete, mat }, gate: { lo, hi, top } }
 * g: the genes (facadeGenes), or null for a plain front.
 * -> { portico: false when the front has its own cover over the door }
 */
export function buildFacade(c, g) {
  const { box, L, U, B, st, H, STOREY, SLAB, mainDoor: door, mats } = c;
  const { mTrim, mAccent, mFrame, mStone, mSlats, mat } = mats;
  if (!g) return { portico: true };
  const fam = st.family;
  const UB = U ? U.B : null, flush = !!UB && Math.abs(UB.z - B.z) < 0.5;        // the first floor's front wall stands on the ground floor's
  const face = B.z - 0.375, wallTop = (U ? STOREY : 0) + H, roofTop = wallTop + SLAB + 2.6, split = U ? STOREY - 0.55 : Infinity;
  const mFeature = fam === 'spanish' ? mAccent : mTrim;                         // the frame and the slabs
  const matOf = (k) => (k === 'timber' ? mSlats : k === 'stone' ? mStone : k === 'dark' ? mFrame : fam === 'modern' ? mSlats : mStone);     // 'auto': timber on a modern front, stone on the others
  const mFin = fam === 'classic' ? mAccent : mSlats;
  const mLamp = new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffd890', emissiveIntensity: 1.3 });

  // a piece of the front, cut where the storeys meet so each part hides with its storey (ground / first floor / above the walls)
  const put = (x0, x1, y0, y1, z0, z1, m, collide = false) => {
    for (const [a, b, parent] of [[y0, Math.min(y1, split), c.world], [Math.max(y0, split), Math.min(y1, wallTop), U ? c.upperG : c.world], [Math.max(y0, wallTop), y1, c.roofG]]) {
      if (b - a > 0.02 && x1 - x0 > 0.02) box(parent, x0, x1, a, b, z0, z1, m, collide && parent === c.world);
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
  /** A frame round a window that joins the sunshade already over it: a deep box (two cheeks and a ledge) or an L (the cheek on the door's side only). */
  const winFrame = (h, kind, depth) => {
    const p = h.win, o0 = p.at - p.w / 2, o1 = p.at + p.w / 2, y0 = h.dy + p.sill, y1 = h.dy + p.top, doorSide = door.at < p.at ? -1 : 1;
    if (kind === 'box' || doorSide < 0) put(o0 - 0.7, o0 - 0.38, y0 - 0.55, y1 + 0.62, face - depth, face, mFeature);
    if (kind === 'box' || doorSide > 0) put(o1 + 0.38, o1 + 0.7, y0 - 0.55, y1 + 0.62, face - depth, face, mFeature);
    if (kind === 'box') put(o0 - 0.7, o1 + 0.7, y0 - 0.55, y0 - 0.27, face - depth, face, mFeature);
  };
  /** Free stretches of the first floor's front wall between x0 and x1 (no window in them), widest first. */
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
  const doorLeft = door.at <= B.x + B.w / 2;                                       // the door is in the left half: the feature wall and the C's side wall go right
  const taken = [];                                                                // stretches of the front (x0, x1) already holding a strong piece
  const clear = (a, b) => !taken.some(([p, q]) => a < q + 0.3 && b > p - 0.3);
  let portico = g.entry === 'portico';

  // ---- the entrance
  if (g.entry === 'frame') {                                       // two piers and a beam standing proud of the wall, rising past the parapet, clad inside
    const fx0 = Math.max(left, door.at - door.w / 2 - g.frameW), fx1 = Math.min(right, door.at + door.w / 2 + g.frameW), fz = face - g.proj, ft = top + g.rise;
    put(fx0, fx0 + 0.75, 0, ft, fz, face, mFeature, !c.carportAtFront); put(fx1 - 0.75, fx1, 0, ft, fz, face, mFeature, !c.carportAtFront);      // under a car porch the piers do not block the cars parked beside the door
    put(fx0, fx1, ft - 0.9, ft, fz, face, mFeature);
    clad(fx0 + 0.75, fx1 - 0.75, door.top + 0.5, ft - 0.9, 0.16, matOf(g.fill));
    put(fx0 + 0.75, fx1 - 0.75, door.top + 0.55, door.top + 0.95, face - Math.max(3, g.proj + 1.6), face, mFeature);     // a canopy over the door, inside the frame
    taken.push([fx0, fx1]);
  } else if (g.entry === 'canopy' && !c.carportAtFront) {           // a thin slab over the door, reaching to the side
    const cx0 = Math.max(left, door.at - door.w / 2 - (doorLeft ? 1.2 : 4.5)), cx1 = Math.min(right, door.at + door.w / 2 + (doorLeft ? 4.5 : 1.2));
    put(cx0, cx1, door.top + 0.6, door.top + 1.0, face - 3.4, face, mFeature);
  } else portico = true;                                            // the style's own portico (scene.js builds it)

  // ---- the feature wall, on the side away from the door
  if (g.wall) {
    const tw = Math.max(5, Math.min(9, B.w * g.wallW)), tx0 = doorLeft ? right - tw : left, tx1 = tx0 + tw, tt = top + Math.max(1.2, g.rise);
    if (clear(tx0, tx1)) {
      clad(tx0, tx1, 0, tt, Math.max(0.5, Math.min(0.9, g.proj * 0.5)), matOf(g.wallMat));
      put(tx0 - 0.15, tx1 + 0.15, tt, tt + 0.3, face - 1.0, face + 0.2, mFeature);
      if (g.slit) { const sx = doorLeft ? tx0 - 0.75 : tx1 + 0.25; if (clear(sx, sx + 0.5)) put(sx, sx + 0.5, 0.4, top - 0.4, face - 0.12, face, mFrame); }      // a recessed dark strip the height of the house
      taken.push([tx0, tx1]);
    }
  }

  // ---- floating slabs
  const d = Math.max(1.6, g.proj);
  if (g.slabs !== 'none') {
    const yb = U ? STOREY - 0.75 : door.top + 0.6, yt = (U ? wallTop : H) + SLAB + Math.min(1.8, g.rise);
    const roofSlab = (g.slabs === 'roof' || g.slabs === 'C') && (tall || !U), band = (g.slabs === 'band' || g.slabs === 'C') && !!U;
    if (roofSlab) put(left - 0.2, right + 0.2, yt, yt + 0.55, face - d, face, mFeature);
    if (band) put(left - 0.2, right + 0.2, yb, yb + 0.5, face - d, face, mFeature);
    if (g.slabs === 'C' && roofSlab) {                              // the side wall that joins them, on the side away from the door
      const wx = doorLeft ? right - 0.5 : left - 0.2;
      if (clear(wx, wx + 0.7)) put(wx, wx + 0.7, U ? yb : 0, yt, face - d, face, mFeature, !U);
    }
    if (!U && roofSlab) portico = false;
  }

  // ---- on the wall upstairs: fins on the widest blank stretch, or cladding between the windows
  if (tall) {
    const free = blankUp(left + 0.6, right - 0.6).flatMap(([a, b]) => { let parts = [[a, b]]; for (const [p, q] of taken) parts = parts.flatMap(([s, e]) => [[s, Math.min(e, p - 0.3)], [Math.max(s, q + 0.3), e]]); return parts; }).filter(([a, b]) => b - a >= 2.2).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
    if (g.fins && free[0]) { const [a, b] = free[0], w = Math.min(b - a, 7.5), mid = (a + b) / 2; fins(mid - w / 2, mid + w / 2, STOREY + 0.4, wallTop - 0.2); }
    else if (g.cladUp) for (const [a, b] of free.slice(0, 2)) clad(a + 0.2, b - 0.2, STOREY + 0.2, wallTop, 0.14, matOf(g.fill));
  } else if (!U && g.cladUp) clad(left + 1, right - 1, door.top + 1.2, H + SLAB + 1.2, 0.14, matOf(g.fill));

  // ---- window frames (upstairs; every front window of a single-storey house), outside the pieces already there
  if (g.win !== 'none') for (const h of holes) if (h.win && (h.upper || !U) && clear(h.x0 + 0.6, h.x1 - 0.6)) winFrame(h, g.win, g.slabs === 'none' ? 1.5 : Math.min(2, d));

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
