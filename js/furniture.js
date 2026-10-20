// Furniture placement for a drafted plan: every room gets the pieces a Pakistani home would have, put where a person would
// put them (beds with the headboard on a wall, a sofa facing the television, kitchen counters in runs along the walls,
// a table with chairs around it ...), never across a door, a window or the way through the room.
//
// Pure geometry, no drawing: furnish(layout) -> items. Coordinates are feet, x across the plot, z away from the road.
//   item = { k, x, z, fx, fz, w, d, h, y, room, soft }
//   (x, z) centre of the footprint; (fx, fz) the way the front of the piece faces (a unit step along x or z);
//   w along the front, d deep, h tall, y height above the floor it stands at; soft = a rug or the like (walk over it)
// The 3D walkthrough turns each k into a model (furn3d.js); the plan can draw the footprints.

const WALL = 0.45;                       // half the thickness of an inside wall: furniture starts this far from the room's edge
const STEP = 0.5;                        // positions are tried every half foot
const R2 = (v) => Math.round(v * 100) / 100;

// real sizes (ft): w across the front, d deep, h tall
const CAT = {
  bedKing: { w: 6, d: 6.8, h: 2.2 }, bedQueen: { w: 5, d: 6.7, h: 2.2 }, bedSingle: { w: 3.3, d: 6.5, h: 2 },
  bedside: { w: 1.6, d: 1.4, h: 1.8 }, lampTable: { w: 0.8, d: 0.8, h: 1.4 },
  wardrobe: { w: 5, d: 2, h: 7 }, wardrobeSmall: { w: 3, d: 2, h: 7 },
  tvUnit: { w: 5, d: 1.6, h: 1.8 }, tv: { w: 3.6, d: 0.4, h: 2.2 },
  sofa3: { w: 7, d: 3, h: 2.8 }, sofa2: { w: 5.5, d: 3, h: 2.8 }, armchair: { w: 2.8, d: 2.8, h: 2.8 },
  coffeeTable: { w: 3.5, d: 2, h: 1.4 }, sideTable: { w: 1.6, d: 1.6, h: 1.8 },
  tableDining6: { w: 5.5, d: 3, h: 2.5 }, tableDining4: { w: 4, d: 2.8, h: 2.5 }, tableRound: { w: 3.6, d: 3.6, h: 2.5 }, chair: { w: 1.5, d: 1.5, h: 3 },
  sideboard: { w: 4.5, d: 1.5, h: 2.8 },
  desk: { w: 4.5, d: 2, h: 2.5 }, deskChair: { w: 1.8, d: 1.8, h: 3.4 }, bookcase: { w: 2.5, d: 1, h: 6.5 }, bookcaseWide: { w: 5, d: 1.1, h: 6.5 },
  counter: { w: 2, d: 2.1, h: 3 }, sink: { w: 2.4, d: 2.1, h: 3 }, stove: { w: 2.2, d: 2.1, h: 3 }, fridge: { w: 2.6, d: 2.4, h: 6 },
  hood: { w: 2.2, d: 1.6, h: 1.4 }, upper: { w: 2, d: 1, h: 2.2 },
  toilet: { w: 1.4, d: 2.2, h: 2.2 }, basin: { w: 1.6, d: 1.3, h: 3 }, shower: { w: 3, d: 3, h: 7 }, bathtub: { w: 2.7, d: 5.5, h: 1.8 }, mirror: { w: 1.5, d: 0.2, h: 2 },
  plant: { w: 1.4, d: 1.4, h: 3.5 }, floorLamp: { w: 1, d: 1, h: 5 }, coat: { w: 1.5, d: 0.5, h: 3 },
  fan: { w: 3.6, d: 3.6, h: 1 },
  rugBig: { w: 8, d: 5.5, h: 0.05 }, rugMid: { w: 6, d: 4, h: 0.05 }, mat: { w: 2.5, d: 4, h: 0.05 },
  pot: { w: 1.2, d: 1.2, h: 3 },
};

const overlap = (a, b) => a.x0 < b.x1 - 1e-6 && a.x1 > b.x0 + 1e-6 && a.z0 < b.z1 - 1e-6 && a.z1 > b.z0 + 1e-6;
const rectOf = (cx, cz, fx, fz, w, d) => {
  const [ex, ez] = fz !== 0 ? [w, d] : [d, w];
  return { x0: cx - ex / 2, x1: cx + ex / 2, z0: cz - ez / 2, z1: cz + ez / 2 };
};

/** Furniture for every room of a layout (a ground floor or a first floor). */
export function furnish(L) {
  const out = [];
  const ops = (L.openings || []).filter((o) => o.kind !== 'window' || true);
  for (const room of L.rooms) {
    if (room.type === 'stairs' || room.type === 'passage') continue;
    out.push(...furnishRoom(room, L, ops));
  }
  for (const sp of L.open || []) if (sp.type === 'terrace') out.push(...terraceItems(sp));
  return out;
}

function terraceItems(sp) {
  const items = [];
  let n = 0;
  const add = (k, x, z, fx, fz) => items.push({ k, key: `terrace${sp.x}_${sp.z}|${k}|${++n}`, x: R2(x), z: R2(z), fx, fz, ...CAT[k], y: 0, room: 'terrace' });
  const cx = sp.x + sp.w / 2;
  if (sp.w >= 8 && sp.d >= 5) {
    for (const x of [sp.x + 1.2, sp.x + sp.w - 1.2]) add('plant', x, sp.z + sp.d - 1, 0, -1);
    if (sp.w >= 13) { add('tableRound', cx, sp.z + sp.d / 2, 0, 1); add('chair', cx - 2.3, sp.z + sp.d / 2, 1, 0); add('chair', cx + 2.3, sp.z + sp.d / 2, -1, 0); }
  }
  return items;
}

function furnishRoom(room, L, ops) {
  const R = { x0: room.x, x1: room.x + room.w, z0: room.z, z1: room.z + room.d };
  const inner = { x0: R.x0 + WALL, x1: R.x1 - WALL, z0: R.z0 + WALL, z1: R.z1 - WALL };
  const items = [], blockers = [], doors = [], windows = [];
  let relax = false;                                              // second try for a bed: only the doorway itself must stay clear
  const isBath = room.type.endsWith('bath');
  const eq = (a, b) => Math.abs(a - b) < 0.06;

  // ---- doors and windows on this room's walls; the washroom of a bedroom is a block inside it
  const addZone = (o, c, at, w, kind) => {
    let z = null, into = null;
    const swing = kind === 'window' ? 1 : isBath ? 1.7 : Math.max(2.7, w + 0.2), m = 0.1;
    if (o === 'h') {
      if (at < R.x0 - 0.1 || at > R.x1 + 0.1) return;
      if (eq(c, R.z0)) { z = { x0: at - w / 2 - m, x1: at + w / 2 + m, z0: R.z0, z1: R.z0 + swing }; into = [0, 1]; }
      else if (eq(c, R.z1)) { z = { x0: at - w / 2 - m, x1: at + w / 2 + m, z0: R.z1 - swing, z1: R.z1 }; into = [0, -1]; }
    } else {
      if (at < R.z0 - 0.1 || at > R.z1 + 0.1) return;
      if (eq(c, R.x0)) { z = { z0: at - w / 2 - m, z1: at + w / 2 + m, x0: R.x0, x1: R.x0 + swing }; into = [1, 0]; }
      else if (eq(c, R.x1)) { z = { z0: at - w / 2 - m, z1: at + w / 2 + m, x0: R.x1 - swing, x1: R.x1 }; into = [-1, 0]; }
    }
    if (!z) return;
    const core = o === 'h'
      ? { x0: at - w / 2, x1: at + w / 2, z0: into[1] > 0 ? R.z0 : R.z1 - 1.2, z1: into[1] > 0 ? R.z0 + 1.2 : R.z1 }
      : { z0: at - w / 2, z1: at + w / 2, x0: into[0] > 0 ? R.x0 : R.x1 - 1.2, x1: into[0] > 0 ? R.x0 + 1.2 : R.x1 };
    (kind === 'window' ? windows : doors).push({ ...z, o, c, at, w, into, core });
  };
  for (const op of ops) addZone(op.o, op.c, op.at, op.w, op.kind === 'window' ? 'window' : 'door');
  const att = room.att;
  if (att) {                                                     // a bedroom's own washroom takes a corner; its door needs room to swing
    blockers.push({ x0: att.x - 0.1, x1: att.x + att.w + 0.1, z0: att.z - 0.1, z1: att.z + att.d + 0.1 });
    const bd = ops.find((o) => o.kind === 'door' && o.room === att.id);
    if (bd) {
      const right = att.x > room.x + 0.01 && att.x + att.w >= R.x1 - 0.1 ? -1 : 1;                      // the swing faces away from the bath
      const bz = { x0: right < 0 ? bd.c - 2.7 : bd.c, x1: right < 0 ? bd.c : bd.c + 2.7, z0: bd.at - 1.35, z1: bd.at + 1.35 };
      blockers.push(bz);
      doors.push({ ...bz, o: 'v', c: bd.c, at: bd.at, w: 2.5, into: [right, 0] });
    }
  }
  for (const d of doors) blockers.push(d);
  const solidBlocks = att ? [{ x0: att.x - 0.2, x1: att.x + att.w + 0.2, z0: att.z - 0.2, z1: att.z + att.d + 0.2 }] : [];   // with its walls

  const toPoint = (d) => ({ x: d.o === 'v' ? d.c : d.at, z: d.o === 'h' ? d.c : d.at });
  const doorPts = doors.map(toPoint);

  // ---- placing
  const free = (f, { tall = false, soft = false, allowDoor = false, ignoreReserve = false } = {}) => {
    if (f.x0 < inner.x0 - 1e-6 || f.x1 > inner.x1 + 1e-6 || f.z0 < inner.z0 - 1e-6 || f.z1 > inner.z1 + 1e-6) return false;
    for (const b of blockers) if (!(allowDoor && doors.includes(b)) && overlap(f, relax && b.core ? b.core : b)) return false;
    if (tall) for (const wn of windows) if (overlap(f, wn)) return false;
    if (!soft) for (const it of items) if (!it.soft && overlap(f, it.fp)) return false;
    if (!soft && !ignoreReserve) for (const it of items) if (it.reserve && overlap(f, it.reserve)) return false;
    return true;
  };
  const nth = {};
  const commit = (k, cx, cz, fx, fz, extra = {}) => {
    const c = CAT[extra.cat || k], w = extra.w ?? c.w, d = extra.d ?? c.d;
    nth[k] = (nth[k] || 0) + 1;
    const it = { k, key: `${room.id}|${k}|${nth[k]}`, x: R2(cx), z: R2(cz), fx, fz, w, d, h: extra.h ?? c.h, y: extra.y || 0, room: room.id, soft: !!extra.soft, deco: !!extra.deco };
    if (extra.host) it.host = extra.host;
    it.fp = rectOf(cx, cz, fx, fz, w, d);
    if (extra.clear) it.reserve = frontZone(it.fp, fx, fz, extra.clear);
    items.push(it);
    // a solid piece must leave the way through the room open: every door reachable from the first, most of the floor too
    if (!it.soft && !it.deco && extra.walk !== false && doors.length && !walkable(items.filter((i) => !i.deco), inner, doors, solidBlocks)) {
      items.pop(); nth[k]--;
      return null;
    }
    return it;
  };
  const behind = (host, k, extra = {}) => {                       // a thin piece against the back of `host`, facing the same way
    const c = CAT[extra.cat || k], d = extra.d ?? c.d, back = host.d / 2 - d / 2;
    return commit(k, host.x - host.fx * back, host.z - host.fz * back, host.fx, host.fz, { ...extra, soft: true, deco: true, host: host.key });
  };
  const frontZone = (fp, fx, fz, c) => ({ x0: fx > 0 ? fp.x1 : fx < 0 ? fp.x0 - c : fp.x0, x1: fx > 0 ? fp.x1 + c : fx < 0 ? fp.x0 : fp.x1, z0: fz > 0 ? fp.z1 : fz < 0 ? fp.z0 - c : fp.z0, z1: fz > 0 ? fp.z1 + c : fz < 0 ? fp.z0 : fp.z1 });

  /** Candidate spots with the back on a wall: [{cx, cz, fx, fz, along, wall}] */
  const wallSpots = (w, d, walls = ['S', 'N', 'W', 'E'], gap = 0.03) => {
    const out = [];
    for (const wall of walls) {
      if (wall === 'S' || wall === 'N') {
        for (let a = inner.x0 + w / 2; a <= inner.x1 - w / 2 + 1e-6; a += STEP) out.push({ cx: a, cz: wall === 'S' ? inner.z0 + d / 2 + gap : inner.z1 - d / 2 - gap, fx: 0, fz: wall === 'S' ? 1 : -1, along: a - (inner.x0 + inner.x1) / 2, wall });
      } else {
        for (let a = inner.z0 + w / 2; a <= inner.z1 - w / 2 + 1e-6; a += STEP) out.push({ cx: wall === 'W' ? inner.x0 + d / 2 + gap : inner.x1 - d / 2 - gap, cz: a, fx: wall === 'W' ? 1 : -1, fz: 0, along: a - (inner.z0 + inner.z1) / 2, wall });
      }
    }
    return out;
  };
  const nearDoor = (x, z) => (doorPts.length ? Math.min(...doorPts.map((p) => Math.hypot(p.x - x, p.z - z))) : 10);
  const wallLen = (wall) => (wall === 'S' || wall === 'N' ? inner.x1 - inner.x0 : inner.z1 - inner.z0);

  /** Put a piece against a wall at the best spot; score(spot, footprint) -> number (higher is better). */
  const onWall = (k, o = {}) => {
    const c = CAT[o.cat || k], w = o.w ?? c.w, d = o.d ?? c.d, h = o.h ?? c.h;
    const spots = [];
    for (const s of wallSpots(w, d, o.walls)) {
      const fp = rectOf(s.cx, s.cz, s.fx, s.fz, w, d);
      const need = o.clear ? frontZone(fp, s.fx, s.fz, o.clear) : null;
      if (!free(fp, { tall: h > 3 || o.tall })) continue;
      if (need && (!(need.x0 >= inner.x0 - 1e-6 && need.x1 <= inner.x1 + 1e-6 && need.z0 >= inner.z0 - 1e-6 && need.z1 <= inner.z1 + 1e-6) || blockers.some((b) => !doors.includes(b) && overlap(need, b)) || items.some((it) => !it.soft && overlap(need, it.fp)))) continue;
      let sc = o.score ? o.score(s, fp) : 0;
      if (o.center) sc -= Math.abs(s.along) * o.center;
      spots.push({ s, sc });
    }
    spots.sort((a, b) => b.sc - a.sc);
    for (const { s } of spots.slice(0, 25)) {                      // the best spot that keeps the room walkable
      const it = commit(k, s.cx, s.cz, s.fx, s.fz, { ...o, cat: o.cat || k, w, d, h });
      if (it) return it;
    }
    return null;
  };
  /** Free-standing piece: best spot on a grid (the footprint plus `pad` all round must be free). */
  const island = (k, o = {}) => {
    const c = CAT[o.cat || k], w = o.w ?? c.w, d = o.d ?? c.d, pad = o.pad ?? 0;
    const fx = o.fx ?? 0, fz = o.fz ?? 1;
    const spots = [];
    for (let x = inner.x0 + w / 2; x <= inner.x1 - w / 2 + 1e-6; x += STEP) {
      for (let z = inner.z0 + d / 2; z <= inner.z1 - d / 2 + 1e-6; z += STEP) {
        const fp = rectOf(x, z, fx, fz, w, d);
        const padded = { x0: fp.x0 - pad, x1: fp.x1 + pad, z0: fp.z0 - pad, z1: fp.z1 + pad };
        const clipped = { x0: Math.max(padded.x0, inner.x0), x1: Math.min(padded.x1, inner.x1), z0: Math.max(padded.z0, inner.z0), z1: Math.min(padded.z1, inner.z1) };
        if (!free(fp)) continue;
        if (pad && blockers.some((b) => overlap(padded, b) && !windows.includes(b))) continue;
        if (pad && items.some((it) => !it.soft && overlap(clipped, it.fp))) continue;
        spots.push({ x, z, sc: o.score ? o.score(x, z, fp) : 0 });
      }
    }
    spots.sort((a, b) => b.sc - a.sc);
    for (const sp of spots.slice(0, 20)) {
      const it = commit(k, sp.x, sp.z, fx, fz, { ...o, cat: o.cat || k, w, d });
      if (it) return it;
    }
    return null;
  };
  const at = (k, cx, cz, fx, fz, o = {}) => {
    const c = CAT[o.cat || k], w = o.w ?? c.w, d = o.d ?? c.d;
    const fp = rectOf(cx, cz, fx, fz, w, d);
    if (!free(fp, { soft: o.soft, tall: (o.h ?? c.h) > 3, ignoreReserve: o.ignoreReserve })) return null;
    return commit(k, cx, cz, fx, fz, { ...o, cat: o.cat || k, w, d });
  };
  const rug = (k, cx, cz, fx, fz, w, d) => {                       // rugs never block anything; kept inside the room
    const fp = rectOf(cx, cz, fx, fz, w, d);
    if (fp.x0 < inner.x0 || fp.x1 > inner.x1 || fp.z0 < inner.z0 || fp.z1 > inner.z1) return null;
    return commit(k, cx, cz, fx, fz, { cat: 'rugMid', w, d, soft: true, deco: true });
  };
  const centre = { x: (R.x0 + R.x1) / 2, z: (R.z0 + R.z1) / 2 };
  const ceilingFan = () => {
    if (room.w >= 7 && room.d >= 7) items.push({ k: 'fan', key: `${room.id}|fan|1`, x: R2(centre.x), z: R2(centre.z), fx: 0, fz: 1, ...CAT.fan, y: 9, room: room.id, soft: true, deco: true, fp: rectOf(centre.x, centre.z, 0, 1, 0.1, 0.1) });
  };
  const corner = (k, o = {}) => {                                  // a plant or lamp in a free corner (the one farthest from the doors)
    const c = CAT[k], w = c.w, d = c.d;
    let best = null, bs = -1e9;
    for (const [cx, cz] of [[inner.x0 + w / 2, inner.z0 + d / 2], [inner.x1 - w / 2, inner.z0 + d / 2], [inner.x0 + w / 2, inner.z1 - d / 2], [inner.x1 - w / 2, inner.z1 - d / 2]]) {
      const fp = rectOf(cx, cz, 0, 1, w, d);
      if (!free(fp)) continue;
      const sc = nearDoor(cx, cz);
      if (sc > bs) { bs = sc; best = [cx, cz]; }
    }
    return best ? commit(k, best[0], best[1], 0, 1, { cat: k }) : null;
  };

  const area = room.w * room.d;
  const t = room.type;

  if (t === 'bed') bedroom();
  else if (t === 'lounge') living(room.name.includes('Dining'));
  else if (t === 'drawing') living(false, true);
  else if (t === 'dining') dining();
  else if (t === 'kitchen') kitchen();
  else if (isBath) bath();
  else if (t === 'lobby') { onWall('coat', { y: 3.5, h: 3, tall: true }); corner('plant'); }
  else if (t === 'study') study();
  else if (t === 'store') { for (let i = 0; i < 3; i++) onWall('bookcase', { cat: 'bookcase', w: 3, d: 1.2, h: 6.5, walls: ['N', 'S', 'E', 'W'], score: (s) => -nearDoor(s.cx, s.cz) * 0.1 }); }
  else if (t === 'servant') { onWall('bedSingle', { center: 0.2, score: (s) => nearDoor(s.cx, s.cz) }); onWall('wardrobeSmall', { clear: 2 }); }
  else if (t === 'dress') { for (let i = 0; i < 3; i++) onWall('wardrobe', { clear: 2.2 }); }
  else if (t === 'prayer') { at('mat', centre.x, centre.z, 0, 1, { cat: 'mat', soft: true, deco: true }); onWall('bookcase', { cat: 'bookcase', w: 2, d: 1, h: 4 }); }

  if (items.length === 0) return [];
  // the way through: the doors must still reach the rest of the room (remove the last optional pieces until they do)
  while (!walkable(items.filter((i) => !i.deco), inner, doors, solidBlocks) && dropOptional(items)) { /* dropped */ }
  return items.map(({ fp, reserve, ...it }) => it);

  // ================================================================= rooms
  function bedroom() {
    const big = room.w >= 12 && room.d >= 11.5, kinds = big ? ['bedKing', 'bedQueen', 'bedSingle'] : room.w >= 9.5 || room.d >= 11 ? ['bedQueen', 'bedSingle'] : ['bedSingle'];
    let bed = null;
    for (const kind of kinds) {
      const bw = CAT[kind].w, sideFree = (s) => Math.min(s.along + (wallLen(s.wall) - bw) / 2, (wallLen(s.wall) - bw) / 2 - s.along);
      bed = onWall(kind, {
        center: 0.5,
        score: (s, fp) => {
          let v = Math.min(nearDoor(s.cx - s.fx * 3, s.cz - s.fz * 3), 14) * 0.6 + Math.min(sideFree(s), 3) * 1.2;
          v -= windows.filter((wn) => overlap(fp, wn)).length * 4;                // not under a window
          return v;
        },
      });
      if (bed) break;
    }
    if (!bed) {
      relax = true;
      for (const kind of kinds) { if ((bed = onWall(kind, { center: 0.5 }))) break; }
      relax = false;
    }
    if (bed) {
      // bedside tables with a lamp, on each side where there is space
      const side = (sg) => {
        const sx = bed.fz !== 0 ? bed.x + sg * (bed.w / 2 + 0.85) : bed.x - bed.fx * (bed.d / 2 - 0.7);
        const sz = bed.fz !== 0 ? bed.z - bed.fz * (bed.d / 2 - 0.7) : bed.z + sg * (bed.w / 2 + 0.85);
        const t1 = at('bedside', sx, sz, bed.fx, bed.fz);
        if (t1) commit('lampTable', sx, sz, bed.fx, bed.fz, { y: 1.8, soft: true, deco: true, host: t1.key });
      };
      side(-1); side(1);
      rug('rug', bed.x + bed.fx * (bed.d / 2 - 0.5), bed.z + bed.fz * (bed.d / 2 - 0.5), bed.fx, bed.fz, bed.w + 2.2, Math.min(5, bed.d - 1));
    }
    const door = (s) => nearDoor(s.cx, s.cz);
    onWall('wardrobe', { clear: 2.2, score: (s) => -Math.abs(door(s) - 5) * 0.5 + (s.wall === (bed && bed.fz > 0 ? 'N' : bed && bed.fz < 0 ? 'S' : bed && bed.fx > 0 ? 'E' : 'W') ? 2 : 0) });
    if (area >= 150 && bed) {                                                  // a dresser or television unit facing the bed
      const opp = bed.fz > 0 ? 'N' : bed.fz < 0 ? 'S' : bed.fx > 0 ? 'E' : 'W';
      const tv = onWall('tvUnit', { walls: [opp], w: 4, clear: 1, center: 0.4, tall: true });
      if (tv) behind(tv, 'tv', { y: 1.8, w: 3 });
    }
    if (area >= 190) {                                                         // a desk to work at
      const dk = onWall('desk', { clear: 2.4, score: (s) => -nearDoor(s.cx, s.cz) * 0.2 });
      if (dk) commit('deskChair', dk.x + dk.fx * 1.9, dk.z + dk.fz * 1.9, -dk.fx, -dk.fz, { soft: true });
    }
    corner('plant');
    ceilingFan();
  }

  function living(withDining, formal = false) {
    const wantTV = !formal && area >= 90;
    // the sofa group: a sofa on the longest wall without a door in the way, the television on the wall it faces
    const sofaK = room.w >= 12 || room.d >= 12 ? 'sofa3' : 'sofa2';
    const longWall = room.w >= room.d ? ['S', 'N'] : ['W', 'E'];
    const sofa = onWall(sofaK, {
      walls: longWall.length ? [...longWall, ...(['S', 'N', 'W', 'E'].filter((x) => !longWall.includes(x)))] : undefined, center: 0.4, clear: 5.2,
      score: (s) => nearDoor(s.cx, s.cz) * 0.3 + (longWall.includes(s.wall) ? 3 : 0) + (formal ? 0 : (s.wall === 'N' || s.wall === 'W' ? 1 : 0)),
    }) || onWall(sofaK, { center: 0.4 }) || onWall('sofa2', { cat: 'sofa2' });
    if (sofa) {
      const gx = sofa.x + sofa.fx * (sofa.d / 2 + 2.4), gz = sofa.z + sofa.fz * (sofa.d / 2 + 2.4);
      at('coffeeTable', gx, gz, sofa.fx, sofa.fz, { ignoreReserve: true });
      rug('rug', gx, gz, sofa.fx, sofa.fz, 8, 5.4);
      const side = (sg) => {
        const sx = sofa.fz !== 0 ? sofa.x + sg * (sofa.w / 2 + 1) : sofa.x;
        const sz = sofa.fz !== 0 ? sofa.z : sofa.z + sg * (sofa.w / 2 + 1);
        const t2 = at('sideTable', sx, sz, sofa.fx, sofa.fz);
        if (t2) commit('lampTable', sx, sz, sofa.fx, sofa.fz, { y: 1.8, soft: true, deco: true, host: t2.key });
      };
      side(-1); side(1);
      // two armchairs across from each other beside the table
      if (area >= 130) for (const sg of [-1, 1]) {
        if (sofa.fz !== 0) at('armchair', gx + sg * 3.5, gz, -sg, 0, { ignoreReserve: true });
        else at('armchair', gx, gz + sg * 3.5, 0, -sg, { ignoreReserve: true });
      }
      if (wantTV) {
        const opp = sofa.fz > 0 ? 'N' : sofa.fz < 0 ? 'S' : sofa.fx > 0 ? 'E' : 'W';
        const tv = onWall('tvUnit', { walls: [opp], w: 5.5, clear: 0.5, center: 0.3, tall: true }) || onWall('tvUnit', { w: 5.5, clear: 0.5, center: 0.3, tall: true });
        if (tv) behind(tv, 'tv', { y: 1.8 });
      }
      if (formal) onWall('sideboard', { walls: [sofa.fz > 0 ? 'N' : sofa.fz < 0 ? 'S' : sofa.fx > 0 ? 'E' : 'W'], center: 0.3 });
    }
    if (withDining && area >= 200) {                                             // the dining table in the other half of the room
      const k = area >= 260 ? 'tableDining6' : 'tableDining4';
      const tab = island(k, { pad: 2.2, score: (x, z) => -Math.hypot(x - (sofa ? sofa.x : centre.x), z - (sofa ? sofa.z : centre.z)) * -0.5 - nearDoor(x, z) * 0.1 });
      if (tab) chairsAround(tab);
    }
    corner('plant');
    if (area >= 160) corner('floorLamp');
    ceilingFan();
  }

  function chairsAround(tab) {
    const long = tab.w >= tab.d, n = tab.w >= 5 ? 2 : 1;
    const [ex, ez] = tab.fz !== 0 ? [tab.w, tab.d] : [tab.d, tab.w];             // footprint extents
    const lx = ex >= ez;                                                         // long side along x
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 1.9;
      if (lx) { at('chair', tab.x + off, tab.z - ez / 2 - 0.7, 0, 1, { soft: true }); at('chair', tab.x + off, tab.z + ez / 2 + 0.7, 0, -1, { soft: true }); }
      else { at('chair', tab.x - ex / 2 - 0.7, tab.z + off, 1, 0, { soft: true }); at('chair', tab.x + ex / 2 + 0.7, tab.z + off, -1, 0, { soft: true }); }
    }
    if (long) { if (lx) { at('chair', tab.x - ex / 2 - 0.8, tab.z, 1, 0, { soft: true }); at('chair', tab.x + ex / 2 + 0.8, tab.z, -1, 0, { soft: true }); } }
  }

  function dining() {
    const k = area >= 120 ? 'tableDining6' : 'tableDining4';
    const tab = island(k, { pad: 2, score: (x, z) => -Math.hypot(x - centre.x, z - centre.z) });
    if (tab) chairsAround(tab);
    onWall('sideboard', { clear: 1.5, center: 0.3 });
    corner('plant');
    ceilingFan();
  }

  function study() {
    const dk = onWall('desk', { clear: 2.4, center: 0.3, score: (s) => nearDoor(s.cx, s.cz) * 0.1 });
    if (dk) {
      commit('deskChair', dk.x + dk.fx * 1.9, dk.z + dk.fz * 1.9, -dk.fx, -dk.fz, { soft: true });
      commit('laptop', dk.x, dk.z, dk.fx, dk.fz, { y: 2.5, soft: true, deco: true, w: 1.1, d: 0.9, h: 0.7, host: dk.key });
    }
    for (let i = 0; i < 2; i++) onWall('bookcase', { clear: 1.5 });
    corner('plant');
    ceilingFan();
  }

  // Kitchen: counters in runs along the walls, the sink where a window is, the hob with a hood, the fridge at the end.
  function kitchen() {
    const U = CAT.counter.d;
    const runs = [];                                                             // free stretches along each wall
    const wallSegs = (wall) => {
      const horiz = wall === 'S' || wall === 'N';
      const lo = horiz ? inner.x0 : inner.z0, hi = horiz ? inner.x1 : inner.z1;
      const cuts = [];
      for (const b of blockers) {
        const probe = horiz
          ? { x0: lo, x1: hi, z0: wall === 'S' ? inner.z0 : inner.z1 - U, z1: wall === 'S' ? inner.z0 + U : inner.z1 }
          : { x0: wall === 'W' ? inner.x0 : inner.x1 - U, x1: wall === 'W' ? inner.x0 + U : inner.x1, z0: lo, z1: hi };
        if (overlap(probe, b)) cuts.push(horiz ? [b.x0, b.x1] : [b.z0, b.z1]);
      }
      cuts.sort((a, b) => a[0] - b[0]);
      const segs = []; let cur = lo;
      for (const [a, b] of cuts) { if (a - cur > 0.5) segs.push([cur, Math.min(a, hi)]); cur = Math.max(cur, b); }
      if (hi - cur > 0.5) segs.push([cur, hi]);
      return segs.map(([a, b]) => ({ wall, a, b, len: b - a }));
    };
    for (const wall of ['S', 'N', 'W', 'E']) runs.push(...wallSegs(wall));
    runs.sort((p, q) => q.len - p.len);
    const used = [];
    const pickRuns = () => {
      const first = runs[0];
      if (!first) return [];
      used.push(first);
      // a second run on a wall at right angles makes an L (the aisle stays at least 4 ft wide)
      const horiz = first.wall === 'S' || first.wall === 'N';
      const other = runs.find((r) => r !== first && ((r.wall === 'S' || r.wall === 'N') !== horiz) && r.len >= 3.5);
      const across = horiz ? inner.z1 - inner.z0 : inner.x1 - inner.x0;
      const par = runs.find((r) => r !== first && r.wall !== first.wall && (r.wall === 'S' || r.wall === 'N') === horiz && r.len >= 5);
      if (other && area >= 55) used.push(other);
      else if (par && across >= 2 * U + 4.5 && area >= 85) used.push(par);
      return used;
    };
    const sel = pickRuns();
    // one queue of units for all the runs together: sink, hob and fridge first (so they always get a place), counters between
    const total = sel.reduce((a, r) => a + r.len, 0), spare = total - 7.2;
    const fill = (queue) => sel.forEach((run) => {
      const horiz = run.wall === 'S' || run.wall === 'N';
      const fx = horiz ? 0 : run.wall === 'W' ? 1 : -1, fz = horiz ? (run.wall === 'S' ? 1 : -1) : 0;
      let pos = run.a;
      // the sink goes under a window when the run has one
      const win = windows.find((wn) => wn.o === (horiz ? 'h' : 'v') && wn.at >= run.a && wn.at <= run.b && ((run.wall === 'S' && eq(wn.c, R.z0)) || (run.wall === 'N' && eq(wn.c, R.z1)) || (run.wall === 'W' && eq(wn.c, R.x0)) || (run.wall === 'E' && eq(wn.c, R.x1))));
      let guard = 0;
      while (queue.length && pos < run.b - 0.9 && guard++ < 30) {
        let kind = queue[0];
        let wdt = CAT[kind === 'counter' ? 'counter' : kind].w;
        if (kind === 'sink' && win) { const want = win.at - wdt / 2; if (want > pos + 0.6 && queue.length > 4) { kind = 'counter'; wdt = Math.min(CAT.counter.w, want - pos); queue.unshift('counter'); } }
        if (pos + wdt > run.b + 0.05) {
          if (kind !== 'counter') break;                                          // an essential unit goes on the next wall
          wdt = run.b - pos; if (wdt < 0.9) break;
        }
        const cx = horiz ? pos + wdt / 2 : (run.wall === 'W' ? inner.x0 + U / 2 : inner.x1 - U / 2);
        const cz = horiz ? (run.wall === 'S' ? inner.z0 + U / 2 : inner.z1 - U / 2) : pos + wdt / 2;
        const catk = kind === 'fridge' ? 'fridge' : kind === 'sink' ? 'sink' : kind === 'stove' ? 'stove' : 'counter';
        const fpk = rectOf(cx, cz, fx, fz, wdt, kind === 'fridge' ? CAT.fridge.d : U);
        if (kind === 'fridge' && windows.some((wn) => overlap(fpk, wn)) && queue.length > 1) {   // a fridge is tall: let a counter take the window
          const at = queue.findIndex((q) => q === 'counter');
          if (at > 0) { queue.splice(at, 1); queue.unshift('counter'); continue; }
        }
        const hit = items.find((o) => !o.soft && overlap(fpk, o.fp));
        if (hit) { pos = horiz ? hit.fp.x1 : hit.fp.z1; continue; }                // the other run's end: start after it
        queue.shift();
        commit(kind === 'counter' ? 'kcounter' : kind, cx, cz, fx, fz, { cat: catk, w: wdt, d: kind === 'fridge' ? CAT.fridge.d : U, walk: false });
        const host = items[items.length - 1];
        const underWindow = windows.some((wn) => overlap(fpk, wn));                       // wall cabinets and the hood never cover a window
        if (kind === 'stove' && !underWindow) behind(host, 'hood', { cat: 'hood', y: 5.2, w: wdt });
        else if (kind !== 'fridge' && kind !== 'stove' && !underWindow) behind(host, 'kupper', { cat: 'upper', y: 4.8, w: wdt });
        pos += wdt;
      }
    });
    const start = items.length;
    const q1 = ['fridge'];
    if (spare >= 2) q1.push('counter');
    q1.push('sink');
    if (spare >= 4.4) q1.push('counter');
    q1.push('stove');
    for (let i = 0; i < 12; i++) q1.push('counter');
    fill(q1);
    const got = (k) => items.some((i) => i.k === k);
    if (!(got('stove') && got('sink'))) {                                         // not everything fitted: start again with the units that matter, no spare counters
      items.length = start;
      fill(['sink', 'stove', 'fridge', ...Array(12).fill('counter')]);
    }
    // a small table for breakfast when the kitchen is big
    if (area >= 120) { const tab = island('tableDining4', { cat: 'tableDining4', pad: 2.2, w: 3.6, d: 2.6, score: (x, z) => -Math.hypot(x - centre.x, z - centre.z) }); if (tab) { at('chair', tab.x - 2.3, tab.z, 1, 0, { soft: true }); at('chair', tab.x + 2.3, tab.z, -1, 0, { soft: true }); } }
    ceilingFan();
  }

  function bath() {
    const doorP = doorPts[0] || { x: centre.x, z: centre.z };
    const far = (x, z) => Math.hypot(x - doorP.x, z - doorP.z);
    // the seat: back to a wall, not on the wall straight across from the door (it would face whoever opens it), not under a window
    const dr = doors[0], across = dr ? (dr.o === 'v' ? (dr.c < centre.x ? 'E' : 'W') : (dr.c < centre.z ? 'N' : 'S')) : null;
    const tl = onWall('toilet', { clear: 0.9, score: (s, fp) => far(s.cx, s.cz) * 0.4 - (s.wall === across ? 6 : 0) - (windows.some((wn) => overlap(fp, wn)) ? 4 : 0) - (s.fz !== 0 && Math.abs(s.cx - doorP.x) < 1.5 ? 3 : 0) });
    const bsOpt = { clear: 0.8, score: (s) => -far(s.cx, s.cz) * 0.5 };
    const bs = onWall('basin', { ...bsOpt, tall: true }) || onWall('basin', bsOpt);          // the mirror above it should not cover a window
    if (bs) behind(bs, 'mirror', { y: 4.2 });
    // shower in the corner farthest from the door
    let sh = null;
    for (const s of room.w >= 6 && room.d >= 6 ? [3, 2.6] : [2.8, 2.5, 2.2]) {
      let best = null, bsc = -1e9;
      for (const [cx, cz] of [[inner.x0 + s / 2, inner.z0 + s / 2], [inner.x1 - s / 2, inner.z0 + s / 2], [inner.x0 + s / 2, inner.z1 - s / 2], [inner.x1 - s / 2, inner.z1 - s / 2]]) {
        const fp = rectOf(cx, cz, 0, 1, s, s);
        if (!free(fp)) continue;
        const sc = far(cx, cz) - (windows.some((wn) => overlap(fp, wn)) ? 4 : 0);        // a corner without a window if there is one
        if (sc > bsc) { bsc = sc; best = [cx, cz]; }
      }
      if (best) { sh = commit('shower', best[0], best[1], 0, 1, { cat: 'shower', w: s, d: s, soft: true }); break; }
    }
    if (room.w * room.d >= 70 && !sh) onWall('bathtub');
    void tl;
  }
}

/** Is the way through still open? Doors can reach every free cell (>= 85%) of the room: pieces grow 0.8 ft each side, a person's width. */
function walkable(items, inner, doors, walls = []) {
  if (!doors.length) return true;
  const G = 0.5, nx = Math.ceil((inner.x1 - inner.x0) / G), nz = Math.ceil((inner.z1 - inner.z0) / G);
  if (nx < 2 || nz < 2) return true;
  const grow = 0.5;                                               // the walkthrough's visitor is 1 ft wide (scene.js R)
  const blocked = new Uint8Array(nx * nz);
  for (const it of [...items, ...walls.map((fp) => ({ fp }))]) {   // walls: a washroom's block inside the room
    if (it.soft && it.y === 0 && (it.k === 'chair' || it.k === 'deskChair')) continue;     // chairs are pulled out of the way
    if (it.soft) continue;
    const fp = it.fp;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const cx = inner.x0 + (i + 0.5) * G, cz = inner.z0 + (j + 0.5) * G;
      if (cx > fp.x0 - grow && cx < fp.x1 + grow && cz > fp.z0 - grow && cz < fp.z1 + grow) {
        // a piece only blocks cells it covers itself, grown by the person's width only on the open side
        if (cx > fp.x0 - 0.05 && cx < fp.x1 + 0.05 && cz > fp.z0 - 0.05 && cz < fp.z1 + 0.05) blocked[i * nz + j] = 1;
        else if (cx > fp.x0 - grow && cx < fp.x1 + grow && cz > fp.z0 - grow && cz < fp.z1 + grow) blocked[i * nz + j] |= 2;
      }
    }
  }
  // cells that are only "close" to a piece stay walkable unless the gap on both sides is too narrow: approximate by the real footprint
  const cell = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && !blocked[i * nz + j];
  let total = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (cell(i, j)) total++;
  const seen = new Uint8Array(nx * nz), stack = [];
  // flood from the first door only: every other door (a washroom's, a second way in) must be reached from it
  const seedOf = (d) => {
    const c = d.o === 'v' ? d.c : d.at, z = d.o === 'h' ? d.c : d.at;
    const dx = d.into ? d.into[0] * 0.8 : 0, dz = d.into ? d.into[1] * 0.8 : 0;
    return [Math.min(nx - 1, Math.max(0, Math.floor((c + dx - inner.x0) / G))), Math.min(nz - 1, Math.max(0, Math.floor((z + dz - inner.z0) / G)))];
  };
  const seeds = doors.map(seedOf);
  const [i0, j0] = seeds[0];
  if (!cell(i0, j0)) return false;
  seen[i0 * nz + j0] = 1; stack.push([i0, j0]);
  let reached = 0;
  while (stack.length) {
    const [i, j] = stack.pop(); reached++;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = i + a, z = j + b;
      if (cell(x, z) && !seen[x * nz + z]) { seen[x * nz + z] = 1; stack.push([x, z]); }
    }
  }
  if (seeds.some(([i, j]) => !seen[i * nz + j])) return false;
  return total === 0 || reached / total >= 0.8;
}

const ESSENTIAL = new Set(['bedKing', 'bedQueen', 'bedSingle', 'sofa3', 'sofa2', 'kcounter', 'sink', 'stove', 'fridge', 'toilet', 'basin', 'shower', 'tableDining6', 'tableDining4', 'desk']);
function dropOptional(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!ESSENTIAL.has(items[i].k) && !items[i].deco) { items.splice(i, 1); return true; }
  }
  return false;
}

/**
 * The user's own moves on top of the automatic placement: over = { key: { dx, dz, rot, hide } } (feet, quarter turns).
 * A piece keeps to its room; pieces that sit on another (a lamp on its table, a TV on its unit) move with it.
 * Pieces that end up on top of another piece or in front of a door are marked clash.
 */
export function applyOverrides(items, L, over = {}) {
  if (!over || !Object.keys(over).length) return items;
  const byKey = new Map(items.map((i) => [i.key, i]));
  const rooms = new Map((L.rooms || []).map((r) => [r.id, r]));
  const out = [];
  const turn = (fx, fz, q) => { for (let i = 0; i < ((q % 4) + 4) % 4; i++) [fx, fz] = [-fz, fx]; return [fx, fz]; };
  const place = (it, o, pivot) => {
    const n = { ...it };
    const q = o.rot || 0;
    if (pivot) {                                                  // rotate about the host's centre, then move with it
      let rx = it.x - pivot.x0, rz = it.z - pivot.z0;
      for (let i = 0; i < ((q % 4) + 4) % 4; i++) [rx, rz] = [-rz, rx];
      n.x = R2(pivot.x1 + rx); n.z = R2(pivot.z1 + rz);
    } else { n.x = R2(it.x + (o.dx || 0)); n.z = R2(it.z + (o.dz || 0)); }
    [n.fx, n.fz] = turn(it.fx, it.fz, q);
    const r = rooms.get(it.room);
    if (r && !pivot) {                                            // inside its room
      const [ex, ez] = n.fz !== 0 ? [n.w, n.d] : [n.d, n.w];
      n.x = R2(Math.max(r.x + WALL + ex / 2, Math.min(r.x + r.w - WALL - ex / 2, n.x)));
      n.z = R2(Math.max(r.z + WALL + ez / 2, Math.min(r.z + r.d - WALL - ez / 2, n.z)));
    }
    return n;
  };
  const moved = new Map();
  for (const it of items) {
    if (it.host) continue;
    const o = over[it.key];
    if (o && o.hide) continue;
    const n = o ? place(it, o) : it;
    moved.set(it.key, { it, n, o });
    out.push(n);
  }
  for (const it of items) {
    if (!it.host) continue;
    const h = moved.get(it.host);
    if (!h) continue;                                             // its host was removed
    if (!h.o) { out.push(it); continue; }
    out.push(place(it, { rot: h.o.rot || 0 }, { x0: h.it.x, z0: h.it.z, x1: h.n.x, z1: h.n.z }));
  }
  // a moved piece may not sit on another solid piece or in a doorway: it stays where the plan had it (flagged blocked so the editor can say so)
  const fp = (i) => rectOf(i.x, i.z, i.fx, i.fz, i.w, i.d);
  const solid = out.filter((i) => !i.soft && !i.deco);
  for (const a of solid) {
    if (!over[a.key]) continue;
    const fa = fp(a);
    let bad = solid.some((b) => b !== a && b.room === a.room && !over[b.key] && overlap(fa, fp(b)));
    for (const op of L.openings || []) {                          // nor in a doorway
      if (op.kind === 'window') continue;
      const z = op.o === 'h' ? { x0: op.at - op.w / 2, x1: op.at + op.w / 2, z0: op.c - 1.6, z1: op.c + 1.6 } : { x0: op.c - 1.6, x1: op.c + 1.6, z0: op.at - op.w / 2, z1: op.at + op.w / 2 };
      if (overlap(fa, z)) bad = true;
    }
    if (bad) {
      const orig = moved.get(a.key);
      const k = out.indexOf(a);
      if (orig && k >= 0) out[k] = { ...orig.it, blocked: true };
    }
  }
  void byKey;
  return out;
}
