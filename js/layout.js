// Plot rules and the parts every model-drafted layout shares: setbacks, doors and windows (finalize) and cost.
// Coordinates are feet. x = across the plot, z = depth from the road (z=0 is the road/front).

export const MARLA = 225;
export const PRESETS = [
  { label: '5 Marla', w: 25, d: 45 },
  { label: '7 Marla', w: 30, d: 50 },
  { label: '10 Marla', w: 35, d: 65 },
  { label: '1 Kanal', w: 50, d: 90 },
];

// Indicative setbacks only. Verify against CDA/LDA/RDA/DHA before building.
export function ruleFor(w, d) {
  const marla = (w * d) / MARLA;
  if (marla <= 6) return { front: 5, rear: 4, side: 0, cover: 75, label: 'up to 6 marla' };   // the car porch beside the drawing room is the rest of the front open space
  if (marla <= 8.5) return { front: 10, rear: 4, side: 3, cover: 70, label: '6-8 marla' };
  if (marla <= 14) return { front: 12, rear: 5, side: 3, cover: 65, label: '8-14 marla' };
  return { front: 20, rear: 7, side: 5, cover: 60, label: 'kanal and above' };
}

function shared(a, b) {
  const e = 0.01;
  for (const [p, q] of [[a, b], [b, a]]) {
    if (Math.abs(p.x + p.w - q.x) < e) {
      const lo = Math.max(p.z, q.z), hi = Math.min(p.z + p.d, q.z + q.d);
      if (hi - lo > 0.5) return { o: 'v', c: q.x, lo, hi };
    }
    if (Math.abs(p.z + p.d - q.z) < e) {
      const lo = Math.max(p.x, q.x), hi = Math.min(p.x + p.w, q.x + q.w);
      if (hi - lo > 0.5) return { o: 'h', c: q.z, lo, hi };
    }
  }
  return null;
}

// The part of a wall line [lo, hi] at c that a room can put a door in: not where its own washroom sits against that wall.
function doorSpan(room, o, c, lo, hi) {
  const a = room && room.att;
  if (!a) return [lo, hi];
  const on = o === 'v' ? Math.abs(a.x - c) < 0.02 || Math.abs(a.x + a.w - c) < 0.02 : Math.abs(a.z - c) < 0.02 || Math.abs(a.z + a.d - c) < 0.02;
  if (!on) return [lo, hi];
  const [b0, b1] = o === 'v' ? [a.z, a.z + a.d] : [a.x, a.x + a.w];
  const left = [lo, Math.min(hi, b0)], right = [Math.max(lo, b1), hi];
  return left[1] - left[0] >= right[1] - right[0] ? left : right;
}

export function finalize(L) {
  const { rooms, B, rule } = L;
  const mains = rooms.filter((r) => !r.type.endsWith('bath'));
  const openings = [], links = [];
  const byId = (id) => rooms.find((r) => r.id === id);

  // doors to outside, as decided by the checker's rule (outsideDoors in bands.js), so the drawing and the check agree:
  // the main entrance, plus a guest door for a drawing room next to the porch or lawn
  const dOut = L.doorsOut || {};
  let main = dOut.main;
  if (!main) {                                                   // no entrance facing the road: the front wall of the lobby or front-most room
    const r = mains.find((m) => m.type === 'lobby') || mains.reduce((a, m) => (m.z < a.z ? m : a));
    main = { room: r.id, wall: ['h', r.z, r.x, r.x + r.w] };
  }
  const doorWalls = new Set();
  // a door the user dragged is remembered as a fraction along its wall (plan.doorPos), so it stays put as walls move
  const pos = (L.plan && L.plan.doorPos) || {};
  const place = (key, lo, hi, w) => {
    const half = w / 2 + 0.3;
    if (pos[key] == null || hi - lo < 2 * half) return { at: (lo + hi) / 2, key, lo, hi };
    return { at: Math.max(lo + half, Math.min(hi - half, lo + pos[key] * (hi - lo))), key, lo, hi };
  };
  const outDoor = (d, isMain) => {
    const [o, c, lo0, hi0] = d.wall;
    const [lo, hi] = doorSpan(byId(d.room), o, c, lo0, hi0);
    const w = Math.min(isMain ? 3.5 : 3, hi - lo - 0.5);
    const pl = place(`out|${d.room}|${isMain ? 'm' : 'g'}`, lo, hi, w);
    openings.push({ o, c, at: pl.at, span: [lo, hi], key: pl.key, w, kind: 'door', main: isMain, sill: 0, top: isMain ? 7.2 : 7, room: d.room });
    links.push(['outside', d.room]);
    doorWalls.add(`${d.room}|${o}|${c}`);
  };
  if (!L.upper) {                                                // a first floor has no door to the road: its way in is the stairs
    outDoor(main, true);
    (dOut.guests || []).forEach((g) => outDoor(g, false));
  }

  const PREF = {
    lobby: ['lounge', 'dining', 'passage'],
    drawing: ['lobby', 'lounge'],
    kitchen: ['dining', 'lounge', 'lobby', 'passage'],
    dining: ['lounge', 'kitchen'],
  };
  for (const r of mains) {
    if (r.type === 'lounge') continue;
    const prefs = r.type === 'bed'
      ? (r.band === 'front' ? ['drawing', 'lobby', 'lounge', 'passage'] : ['lounge', 'dining', 'lobby', 'passage', 'drawing', 'kitchen'])
      : (PREF[r.type] || ['lounge', 'passage', 'lobby', 'dining']);
    if (r.type === 'stairs') {                                      // the flight needs its doors at the two ends: ground floor at the low end, first floor at the high end
      const alongX = r.w > r.d, lo = alongX ? r.x : r.z, hi = lo + (alongX ? r.w : r.d), order = L.upper ? ['lounge', 'passage', 'bed', 'dining', 'study', 'store', 'lobby'] : ['lobby', 'lounge', 'passage', 'drawing', 'dining', 'kitchen', 'bed'];
      const w = 3; let best = null;
      for (const q of mains) {
        if (q === r) continue;
        const s0 = shared(r, q);
        if (!s0) continue;
        const [a1, b1] = doorSpan(r, s0.o, s0.c, s0.lo, s0.hi), [a2, b2] = doorSpan(q, s0.o, s0.c, a1, b1);
        if (b2 - a2 < 2.4) continue;
        const longWall = alongX ? s0.o === 'h' : s0.o === 'v';
        let at, dist;
        if (longWall) { const target = L.upper ? hi - w / 2 - 0.2 : lo + w / 2 + 0.2; at = Math.max(a2 + w / 2, Math.min(b2 - w / 2, target)); if (b2 - a2 < w) at = (a2 + b2) / 2; dist = Math.abs(at - target); }
        else { at = (a2 + b2) / 2; const endWall = alongX ? s0.c : s0.c; dist = Math.abs(endWall - (L.upper ? hi : lo)) < 0.3 ? 0 : 60; }
        const rank = order.indexOf(q.type) < 0 ? 9 : order.indexOf(q.type);
        const key = dist * 10 + rank;
        if (!best || key < best.key) best = { q, s: { ...s0, lo: a2, hi: b2 }, at, key, w: Math.min(w, Math.max(2.2, b2 - a2 - 0.2)) };
      }
      if (best) {
        const k = `${r.id}|${best.q.id}`;
        const pl = pos[k] != null ? place(k, best.s.lo, best.s.hi, best.w) : { at: best.at, key: k };
        openings.push({ o: best.s.o, c: best.s.c, at: pl.at, span: [best.s.lo, best.s.hi], key: k, w: best.w, kind: 'door', sill: 0, top: 7, room: r.id, to: best.q.id });
        links.push([r.id, best.q.id]);
        continue;
      }
    }
    let pick = null, narrow = null, any = null;
    for (const t of L.upper ? [...prefs, 'stairs'] : prefs) {
      for (const q of mains.filter((m) => m.type === t)) {
        const s0 = shared(r, q);
        if (!s0) continue;
        // keep the door off the part of the wall where either room has its washroom
        const [a1, b1] = doorSpan(r, s0.o, s0.c, s0.lo, s0.hi), [a2, b2] = doorSpan(q, s0.o, s0.c, a1, b1);
        const s = { ...s0, lo: a2, hi: b2 };
        if (s.hi - s.lo >= 3.2) { pick = { q, s }; break; }
        if (!narrow && s.hi - s.lo >= 2.4) narrow = { q, s };          // room for a narrower door beside the washroom
        if (!any && s0.hi - s0.lo >= 3.2) any = { q, s: s0 };          // last resort: the whole shared wall
      }
      if (pick) break;
    }
    if (!pick && !narrow) {                                         // any other neighbour with a clear stretch of wall
      for (const q of mains) {
        if (q === r || (r.type === 'bed' && q.type === 'kitchen')) continue;
        const s0 = shared(r, q);
        if (!s0) continue;
        const [a1, b1] = doorSpan(r, s0.o, s0.c, s0.lo, s0.hi), [a2, b2] = doorSpan(q, s0.o, s0.c, a1, b1);
        if (b2 - a2 >= 2.4) { narrow = { q, s: { ...s0, lo: a2, hi: b2 } }; break; }
      }
    }
    pick ||= narrow || any;
    if (!pick) continue;
    const { q, s } = pick;
    const len = s.hi - s.lo;
    const open = (r.type === 'lobby' && q.type === 'lounge') || (r.type === 'dining' && q.type === 'lounge');
    const w = open ? Math.min(6, len - 1.5) : Math.max(2.2, Math.min(3, len - 0.2));
    const pl = open ? { at: (s.lo + s.hi) / 2 } : place(`${r.id}|${q.id}`, s.lo, s.hi, w);
    openings.push({ o: s.o, c: s.c, at: pl.at, span: [s.lo, s.hi], key: pl.key, w, kind: open ? 'opening' : 'door', sill: 0, top: open ? 8 : 7, room: r.id, to: q.id });
    links.push([r.id, q.id]);
  }
  // bath doors
  for (const b of rooms.filter((r) => r.parent)) {
    const p = byId(b.parent);
    const right = b.x > p.x;
    const pl = place(`${b.id}|${p.id}`, b.z, b.z + b.d, 2.5);
    openings.push({ o: 'v', c: right ? b.x : b.x + b.w, at: pl.at, span: [b.z, b.z + b.d], key: pl.key, w: 2.5, kind: 'door', sill: 0, top: 7, room: b.id, to: p.id });
    links.push([b.id, p.id]);
  }

  // a door onto each terrace of a first floor: a sliding glass door from the room that shares the longest wall with it
  const terraceDoors = [];
  if (L.upper) {
    for (const t of (L.open || []).filter((p) => p.type === 'terrace')) {
      const cands = mains.filter((m) => !['stairs', 'passage', 'store', 'servant'].includes(m.type)).map((m) => ({ m, s: shared(m, { x: t.x, z: t.z, w: t.w, d: t.d }) }))
        .filter((c) => c.s && c.s.hi - c.s.lo >= 3.2)
        .sort((a, b) => ((b.m.type === 'lounge') - (a.m.type === 'lounge')) || ((b.m.type === 'bed') - (a.m.type === 'bed')) || ((b.s.hi - b.s.lo) - (a.s.hi - a.s.lo)));
      const c = cands[0];
      if (!c) continue;
      const [a1, b1] = doorSpan(c.m, c.s.o, c.s.c, c.s.lo, c.s.hi);
      if (b1 - a1 < 3.2) continue;
      const w = Math.min(5, b1 - a1 - 0.6), key = `terrace|${c.m.id}`, pl = place(key, a1, b1, w);
      const op = { o: c.s.o, c: c.s.c, at: pl.at, span: [a1, b1], key, w, kind: 'door', terrace: true, sill: 0, top: 7.4, room: c.m.id, to: 'terrace' };
      openings.push(op); terraceDoors.push(op);
      links.push([c.m.id, 'terrace']);
    }
  }

  // windows on exterior walls
  const bounds = { z0: B.z, z1: B.z + B.d, x0: B.x, x1: B.x + B.w };
  const subtract = (lo, hi, cut) => (cut ? [[lo, Math.min(hi, cut[0])], [Math.max(lo, cut[1]), hi]].filter(([a, b]) => b - a > 0) : [[lo, hi]]);
  // open spaces inside the outline (car porch, light well) also give the rooms around them an outside wall
  const open = L.open || [];
  const near = (a, b) => Math.abs(a - b) < 0.01;
  const openSpans = (e) => open.flatMap((p) => {
    const touch = e.o === 'h' ? (e.front ? near(p.z + p.d, e.c) : near(p.z, e.c)) : (e.left ? near(p.x + p.w, e.c) : near(p.x, e.c));
    if (!touch) return [];
    const lo = Math.max(e.lo, e.o === 'h' ? p.x : p.z), hi = Math.min(e.hi, e.o === 'h' ? p.x + p.w : p.z + p.d);
    return hi - lo > 0 ? [[lo, hi]] : [];
  });
  for (const r of rooms) {
    const isBath = r.type.endsWith('bath');
    const a = r.att;
    const edges = [
      { o: 'h', c: r.z, lo: r.x, hi: r.x + r.w, on: Math.abs(r.z - bounds.z0) < 0.01, front: true },
      { o: 'h', c: r.z + r.d, lo: r.x, hi: r.x + r.w, on: Math.abs(r.z + r.d - bounds.z1) < 0.01 },
      { o: 'v', c: r.x, lo: r.z, hi: r.z + r.d, on: rule.side > 0 && Math.abs(r.x - bounds.x0) < 0.01, left: true },
      { o: 'v', c: r.x + r.w, lo: r.z, hi: r.z + r.d, on: rule.side > 0 && Math.abs(r.x + r.w - bounds.x1) < 0.01 },
    ];
    edges.forEach((e, ei) => {
      if ((r.type === 'lobby' && e.front) || doorWalls.has(`${r.id}|${e.o}|${e.c}`)) return;   // a door to outside is on this wall
      const spans = e.on ? [[e.lo, e.hi]] : openSpans(e);
      if (!spans.length) return;
      let cut = null;
      if (a) {
        if (e.o === 'h' && (Math.abs(a.z - e.c) < 0.01 || Math.abs(a.z + a.d - e.c) < 0.01)) cut = [a.x - 1, a.x + a.w + 1];
        if (e.o === 'v' && (Math.abs(a.x - e.c) < 0.01 || Math.abs(a.x + a.w - e.c) < 0.01)) cut = [a.z - 1, a.z + a.d + 1];
      }
      const w = isBath ? 2 : r.type === 'kitchen' ? 3.5 : r.type === 'lobby' ? 3 : r.type === 'bed' ? 4.5 : 5;
      spans.flatMap(([s0, s1]) => subtract(s0, s1, cut)).forEach(([lo, hi], si) => {
        if (hi - lo < w + 1.5) return;
        const n = Math.max(1, Math.floor((hi - lo) / 10));
        for (let i = 0; i < n; i++) {
          // a window the user slid along its wall keeps its place as a fraction of its own stretch of wall
          const a0 = lo + (i * (hi - lo)) / n, a1 = lo + ((i + 1) * (hi - lo)) / n;
          const pl = place(`w|${r.id}|${ei}|${si}|${i}`, a0, a1, w);
          openings.push({ o: e.o, c: e.c, at: pl.at, span: [a0, a1], key: pl.key, w, kind: 'window', sill: isBath ? 5 : r.type === 'kitchen' ? 3.5 : 3, top: 7, room: r.id, bath: isBath });
          r.hasWindow = true;
        }
      });
    });
  }
  for (const td of terraceDoors) {                                  // a window where the terrace door is would be inside it
    for (let i = openings.length - 1; i >= 0; i--) {
      const o = openings[i];
      if (o.kind === 'window' && o.o === td.o && Math.abs(o.c - td.c) < 0.02 && Math.abs(o.at - td.at) < td.w / 2 + o.w / 2 + 0.3) openings.splice(i, 1);
    }
  }
  L.openings = openings;
  L.links = links;
  return L;
}

export function estimateCost(L) {
  const sq = L.covered;
  return [
    { tier: 'Economy', rate: 3500 },
    { tier: 'Standard', rate: 5500 },
    { tier: 'Premium', rate: 7500 },
  ].map((t) => ({ ...t, total: t.rate * sq }));
}
