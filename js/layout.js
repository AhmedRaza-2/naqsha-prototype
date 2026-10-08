// Rule-based layout engine (prototype stand-in for the ML model).
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
  if (marla <= 6) return { front: 8, rear: 4, side: 0, cover: 75, label: 'up to 6 marla' };
  if (marla <= 8.5) return { front: 10, rear: 4, side: 3, cover: 70, label: '6-8 marla' };
  if (marla <= 14) return { front: 12, rear: 5, side: 3, cover: 65, label: '8-14 marla' };
  return { front: 20, rear: 7, side: 5, cover: 60, label: 'kanal and above' };
}

const r5 = (v) => Math.round(v * 2) / 2;

function splitLen(total, items) {
  const fixed = items.reduce((s, i) => s + (i.fixed || 0), 0);
  const wsum = items.reduce((s, i) => s + (i.fixed ? 0 : i.wt), 0);
  let acc = 0, prev = 0;
  return items.map((it, idx) => {
    acc += it.fixed ? it.fixed : ((total - fixed) * it.wt) / wsum;
    const end = idx === items.length - 1 ? total : r5(acc);
    const out = { ...it, off: prev, len: end - prev };
    prev = end;
    return out;
  });
}

const VARIANTS = {
  A: { label: 'Layout A', tag: 'Family core', f: 0.27, m: 0.30, lobby: 'right', mid: ['kitchen', 'dining', 'lounge'], masterLast: false },
  B: { label: 'Layout B', tag: 'Open lounge', f: 0.24, m: 0.34, lobby: 'left', mid: ['lounge', 'dining', 'kitchen'], masterLast: true },
  C: { label: 'Layout C', tag: 'Compact', f: 0.30, m: 0.26, lobby: 'right', mid: ['kitchen', 'lounge'], masterLast: false },
};
export const VARIANT_IDS = Object.keys(VARIANTS);

const NAMES = {
  drawing: 'Drawing Room', lobby: 'Entrance', lounge: 'TV Lounge', dining: 'Dining',
  kitchen: 'Kitchen', bath: 'Bath', gbath: 'Guest Bath',
};

export function generate(plot, bedsWanted, vid) {
  const V = VARIANTS[vid];
  const { w: W, d: D } = plot;
  const rule = ruleFor(W, D);
  const B = { x: rule.side, z: rule.front, w: W - 2 * rule.side, d: D - rule.front - rule.rear };
  const k = B.w < 26 ? 2 : B.w < 40 ? 3 : 4;
  const nBeds = Math.max(2, Math.min(bedsWanted, B.w < 26 ? 3 : k + 2));
  const back = Math.min(nBeds, k);
  const extra = nBeds - back;
  const narrow = B.w < 26;

  const zs = splitLen(B.d, [V.f, V.m, 1 - V.f - V.m].map((wt) => ({ wt })));
  const rooms = [];
  const place = (band, it, type, name, extra2 = {}) =>
    rooms.push({ id: extra2.id || type, type, name, x: B.x + it.off, z: B.z + band.off, w: it.len, d: band.len, ...extra2 });

  // front band: drawing room, entrance lobby, optional guest bedrooms
  const lobbyW = Math.min(8, Math.max(5, B.w * 0.2));
  const exItems = Array.from({ length: extra }, () => ({ kind: 'bed', wt: 1.1 }));
  const frontItems = V.lobby === 'right'
    ? [...exItems, { kind: 'drawing', wt: 1.1 }, { kind: 'lobby', fixed: lobbyW }]
    : [{ kind: 'lobby', fixed: lobbyW }, { kind: 'drawing', wt: 1.1 }, ...exItems];
  let bedNo = back;
  splitLen(B.w, frontItems).forEach((it) => {
    if (it.kind === 'bed') {
      bedNo++;
      place(zs[0], it, 'bed', extra === 1 ? 'Guest Bedroom' : `Bedroom ${bedNo}`, { id: `bed${bedNo}`, band: 'front' });
    } else place(zs[0], it, it.kind, NAMES[it.kind]);
  });

  // mid band
  let midKinds = V.mid, weights;
  if (narrow || vid === 'C') {
    midKinds = V.mid.filter((m) => m !== 'dining');
    weights = { kitchen: 0.34, lounge: 0.66 };
  } else weights = { kitchen: 0.24, dining: 0.26, lounge: 0.5 };
  const noDining = !midKinds.includes('dining');
  splitLen(B.w, midKinds.map((kind) => ({ kind, wt: weights[kind] }))).forEach((it) =>
    place(zs[1], it, it.kind, it.kind === 'lounge' && noDining ? 'Lounge & Dining' : NAMES[it.kind]));

  // back band: bedrooms
  let bl = Array.from({ length: back }, (_, i) => ({ kind: 'bed', wt: i === 0 ? 1.25 : 1, name: i === 0 ? 'Master Bedroom' : `Bedroom ${i + 1}`, id: `bed${i + 1}` }));
  if (V.masterLast) bl.reverse();
  splitLen(B.w, bl).forEach((it) => place(zs[2], it, 'bed', it.name, { id: it.id, band: 'back' }));

  // attached baths (overlay rectangles in the room's back corner)
  const attach = (room, side, bw, bd) => {
    bd = Math.min(bd, room.d - 3);
    rooms.push({ id: `bath_${room.id}`, type: room.type === 'drawing' ? 'gbath' : 'bath', name: room.type === 'drawing' ? 'Guest Bath' : 'Bath',
      parent: room.id, x: side === 'right' ? room.x + room.w - bw : room.x, z: room.z + room.d - bd, w: bw, d: bd });
    room.att = rooms[rooms.length - 1];
  };
  const mains = rooms.slice();
  mains.filter((r) => r.type === 'bed' && r.band === 'back').sort((a, b) => a.x - b.x)
    .forEach((r, i) => attach(r, i % 2 === 0 ? 'right' : 'left', r.w < 11 ? 4.5 : 5, 7.5));
  mains.filter((r) => r.type === 'bed' && r.band === 'front')
    .forEach((r) => attach(r, V.lobby === 'right' ? 'left' : 'right', r.w < 11 ? 4.5 : 5, 7));
  const drawing = mains.find((r) => r.type === 'drawing');
  attach(drawing, V.lobby === 'right' ? 'left' : 'right', 4.5, 6.5);

  return finalize({ id: vid, label: V.label, tag: V.tag, plot, rule, B, rooms, beds: nBeds, narrow });
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

function finalize(L) {
  const { rooms, B, rule } = L;
  const mains = rooms.filter((r) => !r.type.endsWith('bath'));
  const openings = [], links = [];
  const byId = (id) => rooms.find((r) => r.id === id);

  // main entrance
  const lobby = mains.find((r) => r.type === 'lobby');
  openings.push({ o: 'h', c: B.z, at: lobby.x + lobby.w / 2, w: 3.5, kind: 'door', main: true, sill: 0, top: 7.2, room: lobby.id });
  links.push(['outside', lobby.id]);

  const PREF = {
    lobby: ['lounge', 'dining'],
    drawing: ['lobby', 'lounge'],
    kitchen: ['dining', 'lounge', 'lobby'],
    dining: ['lounge', 'kitchen'],
  };
  for (const r of mains) {
    if (r.type === 'lounge') continue;
    const prefs = r.type === 'bed'
      ? (r.band === 'front' ? ['drawing', 'lobby', 'lounge'] : ['lounge', 'dining', 'lobby', 'drawing', 'kitchen'])
      : PREF[r.type];
    let pick = null;
    for (const t of prefs) {
      for (const q of mains.filter((m) => m.type === t)) {
        const s = shared(r, q);
        if (s && s.hi - s.lo >= 3.2) { pick = { q, s }; break; }
      }
      if (pick) break;
    }
    if (!pick) continue;
    const { q, s } = pick;
    const len = s.hi - s.lo;
    const open = (r.type === 'lobby' && q.type === 'lounge') || (r.type === 'dining' && q.type === 'lounge');
    const w = open ? Math.min(6, len - 1.5) : 3;
    openings.push({ o: s.o, c: s.c, at: (s.lo + s.hi) / 2, w, kind: open ? 'opening' : 'door', sill: 0, top: open ? 8 : 7, room: r.id, to: q.id });
    links.push([r.id, q.id]);
  }
  // bath doors
  for (const b of rooms.filter((r) => r.parent)) {
    const p = byId(b.parent);
    const right = b.x > p.x;
    openings.push({ o: 'v', c: right ? b.x : b.x + b.w, at: b.z + b.d / 2, w: 2.5, kind: 'door', sill: 0, top: 7, room: b.id, to: p.id });
    links.push([b.id, p.id]);
  }

  // windows on exterior walls
  const bounds = { z0: B.z, z1: B.z + B.d, x0: B.x, x1: B.x + B.w };
  const subtract = (lo, hi, cut) => (cut ? [[lo, Math.min(hi, cut[0])], [Math.max(lo, cut[1]), hi]].filter(([a, b]) => b - a > 0) : [[lo, hi]]);
  for (const r of rooms) {
    const isBath = r.type.endsWith('bath');
    const a = r.att;
    const edges = [
      { o: 'h', c: r.z, lo: r.x, hi: r.x + r.w, on: Math.abs(r.z - bounds.z0) < 0.01, front: true },
      { o: 'h', c: r.z + r.d, lo: r.x, hi: r.x + r.w, on: Math.abs(r.z + r.d - bounds.z1) < 0.01 },
      { o: 'v', c: r.x, lo: r.z, hi: r.z + r.d, on: rule.side > 0 && Math.abs(r.x - bounds.x0) < 0.01 },
      { o: 'v', c: r.x + r.w, lo: r.z, hi: r.z + r.d, on: rule.side > 0 && Math.abs(r.x + r.w - bounds.x1) < 0.01 },
    ];
    for (const e of edges) {
      if (!e.on || (r.type === 'lobby' && e.front)) continue;
      let cut = null;
      if (a) {
        if (e.o === 'h' && (Math.abs(a.z - e.c) < 0.01 || Math.abs(a.z + a.d - e.c) < 0.01)) cut = [a.x - 1, a.x + a.w + 1];
        if (e.o === 'v' && (Math.abs(a.x - e.c) < 0.01 || Math.abs(a.x + a.w - e.c) < 0.01)) cut = [a.z - 1, a.z + a.d + 1];
      }
      const w = isBath ? 2 : r.type === 'kitchen' ? 3.5 : r.type === 'lobby' ? 3 : r.type === 'bed' ? 4.5 : 5;
      for (const [lo, hi] of subtract(e.lo, e.hi, cut)) {
        if (hi - lo < w + 1.5) continue;
        const n = Math.max(1, Math.floor((hi - lo) / 10));
        for (let i = 0; i < n; i++) {
          openings.push({ o: e.o, c: e.c, at: lo + ((i + 0.5) * (hi - lo)) / n, w, kind: 'window', sill: isBath ? 5 : r.type === 'kitchen' ? 3.5 : 3, top: 7, room: r.id, bath: isBath });
          r.hasWindow = true;
        }
      }
    }
  }
  L.openings = openings;
  L.links = links;
  L.covered = B.w * B.d;
  L.checks = validate(L);
  L.score = L.checks.filter((c) => c.level === 'ok').length;
  return L;
}

const net = (r) => r.w * r.d - (r.att ? r.att.w * r.att.d : 0);

export function validate(L) {
  const { rooms, plot, rule, B, links } = L;
  const out = [];
  const add = (level, title, detail) => out.push({ level, title, detail });
  const mains = rooms.filter((r) => !r.type.endsWith('bath'));
  const fmt = (r) => `${r.name} (${r.w.toFixed(0)}x${r.d.toFixed(0)} ft)`;

  add('ok', 'Setbacks applied', `Front ${rule.front} ft, rear ${rule.rear} ft, sides ${rule.side} ft (indicative for ${rule.label}; verify with your development authority).`);
  const cov = ((B.w * B.d) / (plot.w * plot.d)) * 100;
  add(cov <= rule.cover ? 'ok' : 'warn', 'Plot coverage', `${cov.toFixed(0)}% covered (limit about ${rule.cover}%).`);

  const MIN = { bed: [95, 9], drawing: [110, 9], lounge: [100, 8], kitchen: [55, 6.5], lobby: [20, 4.5], dining: [70, 7] };
  const small = mains.filter((r) => MIN[r.type] && (net(r) < MIN[r.type][0] || Math.min(r.w, r.d) < MIN[r.type][1]));
  add(small.length ? 'warn' : 'ok', 'Minimum room sizes', small.length ? `Below guideline: ${small.map(fmt).join(', ')}.` : 'All rooms meet the minimum size guidelines (bedroom 95 sq ft net, kitchen 55, drawing 110).');

  add('ok', 'Attached baths', `${mains.filter((r) => r.type === 'bed').length} bedroom(s) each with an attached bath, plus a guest bath off the drawing room.`);

  // graph checks
  const adj = new Map();
  for (const [a, b] of links) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const bfs = (blocked = () => false) => {
    const seen = new Set(['outside']), q = ['outside'];
    while (q.length) {
      const n = q.shift();
      for (const m of adj.get(n) || []) if (!seen.has(m) && !blocked(m)) { seen.add(m); q.push(m); }
    }
    return seen;
  };
  const all = bfs();
  const lost = rooms.filter((r) => !all.has(r.id));
  add(lost.length ? 'warn' : 'ok', 'Every room reachable', lost.length ? `Not reachable from the entrance: ${lost.map((r) => r.name).join(', ')}.` : 'Every room can be reached from the main entrance.');

  const isBed = (id) => { const r = rooms.find((x) => x.id === id); return r && (r.type === 'bed' || (r.parent && rooms.find((x) => x.id === r.parent).type === 'bed')); };
  const guest = bfs(isBed);
  add(guest.has('drawing') ? 'ok' : 'warn', 'Guest privacy', guest.has('drawing') ? 'Guests reach the drawing room without passing through a bedroom.' : 'Drawing room is only reachable through a bedroom.');

  const kit = mains.find((r) => r.type === 'kitchen');
  const bedKitchen = links.some(([a, b]) => (a === 'kitchen' && isBed(b)) || (b === 'kitchen' && isBed(a)));
  add(bedKitchen ? 'warn' : 'ok', 'Bedrooms vs kitchen', bedKitchen ? 'A bedroom opens directly into the kitchen.' : 'No bedroom opens directly into the kitchen.');
  add(kit.hasWindow ? 'ok' : 'warn', 'Kitchen ventilation', kit.hasWindow ? 'Kitchen has an external window.' : 'Kitchen has no external wall; needs an exhaust or ventilator.');

  const dark = mains.filter((r) => ['bed', 'drawing', 'lounge'].includes(r.type) && !r.hasWindow);
  add(dark.length ? 'warn' : 'ok', 'Natural light', dark.length ? `No external window: ${dark.map((r) => r.name).join(', ')} (use a skylight/light well or ventilator).` : 'All habitable rooms have an external window.');
  return out;
}

export function estimateCost(L) {
  const sq = L.covered;
  return [
    { tier: 'Economy', rate: 3500 },
    { tier: 'Standard', rate: 5500 },
    { tier: 'Premium', rate: 7500 },
  ].map((t) => ({ ...t, total: t.rate * sq }));
}

export function generateAll(plot, beds) {
  return VARIANT_IDS.map((v) => generate(plot, beds, v));
}
