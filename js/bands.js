// Band-format plans: parser, geometry and the rule checker. A line-by-line port of tools/bands.py, so the browser
// scores a plan exactly like the training pipeline did (verified against Python in tools/verify_js_port.py).
import { ruleFor, MARLA } from './layout.js';

export const OPEN = new Set(['lawn', 'void', 'porch', 'courtyard', 'garage', 'balcony']);
export const BEDS = new Set(['bed', 'master']);
const TYPES = new Set([...OPEN, ...BEDS, 'bath', 'kitchen', 'lounge', 'drawing', 'dining', 'stairs', 'store', 'lobby', 'passage', 'prayer', 'study', 'servant', 'dress', 'other']);
const r2 = (v) => Math.round(v * 100) / 100;
export const FOCUS_VALUES = ['balanced', 'bedrooms', 'lounge', 'kitchen'];
// typical share of built area taken by bedrooms in balanced plans (by bedroom count); "bigger bedrooms" = 4 points above
const BED_BASE = { 2: 0.42, 3: 0.43, 4: 0.50, 5: 0.55, 6: 0.57 };
const BED_BASE_SMALL = { 1: 0.24, 2: 0.40 };      // plots up to 6 marla (compact layout)

// ---------------------------------------------------------------- text form
const ROOM = /^([a-z]+)(?: ([\d.]+))?(?: \+bath ([\d.]+)x([\d.]+) ([LR]))?$/;

/** Text -> plan. Throws on malformed text. Implicit last widths and the 'rest' depth are resolved to the remainder. */
export function parse(text) {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const m = lines.length ? lines[0].match(/^PLOT ([\d.]+)x([\d.]+) BEDS (\d+)(?: BATHS (\d+))?(?: FOCUS ([a-z]+))?$/) : null;
  if (!m) throw new Error('bad header');
  const W = parseFloat(m[1]), D = parseFloat(m[2]);
  const plan = { plot: { w: W, d: D }, beds: parseInt(m[3], 10), bands: [] };
  if (m[4] !== undefined) plan.baths = parseInt(m[4], 10);
  if (m[5] !== undefined) plan.focus = m[5];
  let usedD = 0;
  lines.slice(1).forEach((ln, li) => {
    const h = ln.match(/^([\d.]+|rest): (.+)$/);
    if (!h) throw new Error(`bad band line: ${ln}`);
    const toks = h[2].split(' | ');
    const rooms = [];
    let usedW = 0;
    toks.forEach((tok, ti) => {
      const rm = tok.trim().match(ROOM);
      if (!rm) throw new Error(`bad room: ${tok}`);
      if (rm[2] === undefined && ti !== toks.length - 1) throw new Error(`missing width: ${tok}`);
      const r = { t: rm[1], w: rm[2] !== undefined ? parseFloat(rm[2]) : r2(W - usedW) };
      usedW += r.w;
      if (rm[3] !== undefined) r.bath = [parseFloat(rm[3]), parseFloat(rm[4]), rm[5]];
      rooms.push(r);
    });
    let d;
    if (h[1] === 'rest') {
      if (li !== lines.length - 2) throw new Error("'rest' depth only allowed on the last band");
      d = r2(D - usedD);
    } else d = parseFloat(h[1]);
    usedD += d;
    plan.bands.push({ d, rooms });
  });
  return plan;
}

/** Plan -> text (same as serialize() in tools/bands.py): the last width of a row and the last depth are implicit. */
export function serialize(plan) {
  const { w, d } = plan.plot;
  let head = `PLOT ${w}x${d} BEDS ${plan.beds}`;
  if (plan.baths != null) head += ` BATHS ${plan.baths}`;
  if (plan.focus) head += ` FOCUS ${plan.focus}`;
  const lines = [head];
  plan.bands.forEach((b, bi) => {
    const toks = b.rooms.map((r, ri) => {
      let t = ri === b.rooms.length - 1 ? r.t : `${r.t} ${r.w}`;
      if (r.bath) t += ` +bath ${r.bath[0]}x${r.bath[1]} ${r.bath[2]}`;
      return t;
    });
    lines.push(`${bi === plan.bands.length - 1 ? 'rest' : b.d}: ${toks.join(' | ')}`);
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------- geometry
/** Band plan -> rectangles in feet (x across, y = depth from the road). Baths get parent = index of their room. */
export function toRects(plan) {
  const rooms = [];
  let y = 0;
  plan.bands.forEach((b, bi) => {
    let x = 0;
    for (const r of b.rooms) {
      rooms.push({ i: rooms.length, t: r.t, x, y, w: r.w, d: b.d, band: bi, bath: r.bath || null });
      x += r.w;
    }
    y += b.d;
  });
  const out = [...rooms];
  for (const r of rooms) {
    if (r.bath) {
      const [bw, bd, side] = r.bath;
      out.push({ i: out.length, t: 'bath', parent: r.i, band: r.band, bath: null, x: side === 'R' ? r.x + r.w - bw : r.x, y: r.y + r.d - bd, w: bw, d: bd });
    }
  }
  return out;
}

function shared(a, b) {
  const e = 0.01;
  for (const [p, q] of [[a, b], [b, a]]) {
    if (Math.abs(p.x + p.w - q.x) < e) {
      const lo = Math.max(p.y, q.y), hi = Math.min(p.y + p.d, q.y + q.d);
      if (hi - lo > 0.5) return ['v', q.x, lo, hi];
    }
    if (Math.abs(p.y + p.d - q.y) < e) {
      const lo = Math.max(p.x, q.x), hi = Math.min(p.x + p.w, q.x + q.w);
      if (hi - lo > 0.5) return ['h', q.y, lo, hi];
    }
  }
  return null;
}

const PREF = { lobby: ['lounge', 'dining'], drawing: ['lobby', 'lounge'], kitchen: ['dining', 'lounge', 'lobby'], dining: ['lounge', 'kitchen'] };
const BED_FRONT = ['drawing', 'lobby', 'lounge'];
const BED_BACK = ['lounge', 'dining', 'lobby', 'drawing', 'kitchen'];
const OTHER = ['lounge', 'passage', 'lobby', 'dining'];
const MINSZ = { bed: [95, 9], master: [110, 9], drawing: [110, 9], lounge: [100, 8], kitchen: [55, 6.5], lobby: [20, 4.5], dining: [70, 7] };
const WINDOW_W = { kitchen: 3.5, bed: 4, master: 4, lobby: 3 };

function links(rects, mains, y0) {
  const out = [];
  for (const r of mains) {
    if (r.t === 'lounge') continue;
    const prefs = BEDS.has(r.t) ? (Math.abs(r.y - y0) < 0.01 ? BED_FRONT : BED_BACK) : (PREF[r.t] || OTHER);
    let pick = null;
    for (const t of prefs) {
      for (const q of mains) {
        if (q.t === t) {
          const s = shared(r, q);
          if (s && s[3] - s[2] >= 3.2) { pick = q; break; }
        }
      }
      if (pick) break;
    }
    if (pick) out.push([r.i, pick.i]);
  }
  for (const b of rects) if (b.t === 'bath') out.push([b.i, b.parent]);
  return out;
}

// open spaces a door to outside can open onto: the lawn and the car porch (not a light well, side strip or balcony)
const ENTRY_OPEN = new Set(['lawn', 'porch', 'garage']);

/** The part of r's front wall (road side) that faces the lawn or porch, as ['h', y, lo, hi], if at least 3 ft long. */
function frontOpen(r, rects) {
  for (const o of rects) {
    if (!ENTRY_OPEN.has(o.t) || Math.abs(o.y + o.d - r.y) >= 0.01) continue;
    const lo = Math.max(o.x, r.x), hi = Math.min(o.x + o.w, r.x + r.w);
    if (hi - lo >= 3) return ['h', r.y, lo, hi];
  }
  return null;
}

/** The wall a drawing room shares with the porch or a lawn (at least 3 ft): where its own guest door goes. */
function guestWall(r, rects) {
  for (const o of rects) {
    if (!ENTRY_OPEN.has(o.t)) continue;
    const s = shared(r, o);
    if (s && s[3] - s[2] >= 3) return s;
  }
  return null;
}

/**
 * Doors to outside, used by the checker and by the plan drawing so both agree:
 *   main  = the lobby, or (common in real plans) a lounge / dining room / passage facing the porch or lawn
 *   wall  = where its door goes; faces = it opens onto the road side
 *   guests = [[drawing room, wall]] for drawing rooms next to the porch or lawn (their own guest door)
 */
export function outsideDoors(rects, mains, y0) {
  const lob = mains.find((r) => r.t === 'lobby');
  let main = null, wall = null, faces = false;
  if (lob) { main = lob; wall = frontOpen(lob, rects); faces = Math.abs(lob.y - y0) < 0.01 && !!wall; }
  else {
    for (const t of ['lounge', 'dining', 'passage']) {
      const r = mains.find((m) => m.t === t && frontOpen(m, rects));
      if (r) { main = r; wall = frontOpen(r, rects); faces = true; break; }
    }
  }
  const guests = mains.filter((r) => r.t === 'drawing' && r !== main).map((r) => [r, guestWall(r, rects)]).filter(([, w]) => w);
  return { main, wall, faces, guests };
}

function hasWindow(r, rects) {
  const need = (WINDOW_W[r.t] ?? 5) + 1.0;
  const bath = rects.find((b) => b.t === 'bath' && b.parent === r.i);
  const opens = rects.filter((o) => OPEN.has(o.t));
  const edges = [
    ['h', r.y, r.x, r.x + r.w, 'front'], ['h', r.y + r.d, r.x, r.x + r.w, 'back'],
    ['v', r.x, r.y, r.y + r.d, 'l'], ['v', r.x + r.w, r.y, r.y + r.d, 'r'],
  ];
  for (const [o_, c, lo, hi, nm] of edges) {
    if (r.t === 'lobby' && nm === 'front') continue;
    const ivs = [];
    for (const o of opens) {
      let touch, a, b;
      if (o_ === 'h') {
        touch = nm === 'front' ? Math.abs(o.y + o.d - c) < 0.01 : Math.abs(o.y - c) < 0.01;
        a = Math.max(lo, o.x); b = Math.min(hi, o.x + o.w);
      } else {
        touch = nm === 'l' ? Math.abs(o.x + o.w - c) < 0.01 : Math.abs(o.x - c) < 0.01;
        a = Math.max(lo, o.y); b = Math.min(hi, o.y + o.d);
      }
      if (touch && b - a > 0) ivs.push([a, b]);
    }
    for (const [a, b] of ivs) {
      let segs = [[a, b]];
      if (bath) {
        let cut = null;
        if (o_ === 'h' && (Math.abs(bath.y - c) < 0.01 || Math.abs(bath.y + bath.d - c) < 0.01)) cut = [bath.x - 0.5, bath.x + bath.w + 0.5];
        if (o_ === 'v' && (Math.abs(bath.x - c) < 0.01 || Math.abs(bath.x + bath.w - c) < 0.01)) cut = [bath.y - 0.5, bath.y + bath.d + 0.5];
        if (cut) segs = [[a, Math.min(b, cut[0])], [Math.max(a, cut[1]), b]];
      }
      if (segs.some(([s, e]) => e - s >= need)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- checker
/** -> [{level: 'ok'|'warn'|'err', name, detail}]. 'err' means the plan is broken and must not be shown. */
export function check(plan, beds = plan.beds) {
  const out = [];
  const add = (level, name, detail = '') => out.push({ level, name, detail });
  const { w: W, d: D } = plan.plot;
  let errs = 0;
  if (!plan.bands.length) return [{ level: 'err', name: 'no bands', detail: '' }];
  plan.bands.forEach((b, bi) => {
    const sw = b.rooms.reduce((s, r) => s + r.w, 0);
    if (Math.abs(sw - W) > 0.26) { add('err', 'band width', `band ${bi}: widths sum to ${sw}, plot is ${W}`); errs++; }
    if (b.d <= 0) { add('err', 'band depth', `band ${bi}: non-positive`); errs++; }
    for (const r of b.rooms) {
      if (!TYPES.has(r.t) || r.t === 'bath') { add('err', 'room type', `unknown/illegal type ${r.t}`); errs++; }
      if (r.w <= 0) { add('err', 'room width', `${r.t} non-positive`); errs++; }
      if (r.bath) {
        const [bw, bd] = r.bath;
        if (bw > r.w - 1 || bd > b.d - 2) { add('err', 'bath fit', `bath ${bw}x${bd} too big for ${r.t}`); errs++; }
      }
    }
  });
  const sd = plan.bands.reduce((s, b) => s + b.d, 0);
  if (Math.abs(sd - D) > 0.26) { add('err', 'plot depth', `band depths sum to ${sd}, plot is ${D}`); errs++; }
  const count = {};
  for (const b of plan.bands) for (const r of b.rooms) count[r.t] = (count[r.t] || 0) + 1;
  const nb = (count.bed || 0) + (count.master || 0);
  for (const need of ['kitchen', 'drawing']) if (!count[need]) { add('err', `missing ${need}`); errs++; }   // a lobby is optional
  if (beds != null && nb !== beds) { add('err', 'bed count', `asked for ${beds}, plan has ${nb}`); errs++; }
  const nbath = plan.bands.reduce((s, b) => s + b.rooms.filter((r) => r.bath).length, 0);
  if (plan.baths != null && nbath !== plan.baths) { add('err', 'bath count', `asked for ${plan.baths}, plan has ${nbath}`); errs++; }
  if (plan.focus != null && !FOCUS_VALUES.includes(plan.focus)) { add('err', 'focus value', String(plan.focus)); errs++; }
  if (errs) return out;

  const rule = ruleFor(W, D);
  const rects = toRects(plan);
  const mains = rects.filter((r) => !OPEN.has(r.t) && r.t !== 'bath');
  const byi = new Map(rects.map((r) => [r.i, r]));
  const x0 = Math.min(...mains.map((r) => r.x)), x1 = Math.max(...mains.map((r) => r.x + r.w));
  const y0 = Math.min(...mains.map((r) => r.y)), y1 = Math.max(...mains.map((r) => r.y + r.d));
  const okSet = y0 >= rule.front - 0.01 && D - y1 >= rule.rear - 0.01 && x0 >= rule.side - 0.01 && W - x1 >= rule.side - 0.01;
  add(okSet ? 'ok' : 'warn', 'setbacks', `front ${y0}/${rule.front} rear ${D - y1}/${rule.rear} sides ${x0},${W - x1}/${rule.side}`);
  const cov = (mains.reduce((s, r) => s + r.w * r.d, 0) / (W * D)) * 100;
  add(cov <= rule.cover + 0.01 ? 'ok' : 'warn', 'coverage', `${Math.round(cov)}% (limit ${rule.cover}%)`);

  const small = [];
  for (const r of mains) {
    if (MINSZ[r.t]) {
      const net = r.w * r.d - (r.bath ? r.bath[0] * r.bath[1] : 0);
      if (net < MINSZ[r.t][0] || Math.min(r.w, r.d) < MINSZ[r.t][1]) small.push(r.t);
    }
  }
  add(small.length ? 'warn' : 'ok', 'min room sizes', small.join(','));
  const nobath = mains.filter((r) => BEDS.has(r.t) && !r.bath).map((r) => r.t);
  add(nobath.length ? 'warn' : 'ok', 'attached baths', `${nobath.length} bedroom(s) without`);
  // main entrance: a lobby, or (common in real plans) a lounge / dining room entered straight from the porch or lawn
  const out_ = outsideDoors(rects, mains, y0);
  add(out_.faces ? 'ok' : 'warn', 'entrance on road side');

  const lk = links(rects, mains, y0);
  const doorsOut = [...(out_.main ? [out_.main.i] : []), ...out_.guests.map(([r]) => r.i)];
  const adj = new Map();
  for (const [a, b] of [...lk, ...doorsOut.map((i) => [-1, i])]) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b); adj.get(b).push(a);
  }
  const bfs = (blocked = () => false) => {
    const seen = new Set([-1]);
    const q = [-1];
    while (q.length) {
      const n = q.pop();
      for (const m of adj.get(n) || []) if (!seen.has(m) && !blocked(m)) { seen.add(m); q.push(m); }
    }
    return seen;
  };
  const all = bfs();
  const lost = rects.filter((r) => !OPEN.has(r.t) && !all.has(r.i)).map((r) => r.t);
  add(lost.length ? 'warn' : 'ok', 'every room reachable', lost.join(','));
  const isBed = (i) => BEDS.has(byi.get(i).t) || (byi.get(i).t === 'bath' && BEDS.has(byi.get(byi.get(i).parent).t));
  const guest = bfs(isBed);
  add(mains.some((r) => r.t === 'drawing' && guest.has(r.i)) ? 'ok' : 'warn', 'guest privacy');
  const kit = mains.filter((r) => r.t === 'kitchen');
  const kitIds = new Set(kit.map((k) => k.i));
  const bk = lk.some(([a, b]) => (kitIds.has(a) && isBed(b)) || (kitIds.has(b) && isBed(a)));
  add(bk ? 'warn' : 'ok', 'bedroom not opening into kitchen');
  add(kit.some((k) => hasWindow(k, rects)) ? 'ok' : 'warn', 'kitchen ventilation');
  const dark = mains.filter((r) => (BEDS.has(r.t) || r.t === 'drawing') && !hasWindow(r, rects)).map((r) => r.t);
  add(dark.length ? 'warn' : 'ok', 'natural light', dark.join(','));
  if (['bedrooms', 'lounge', 'kitchen'].includes(plan.focus)) {
    const built = mains.reduce((s, r) => s + r.w * r.d, 0);
    const share = (ts) => mains.filter((r) => ts.includes(r.t)).reduce((s, r) => s + r.w * r.d, 0) / built;
    const f = plan.focus;
    const base = (W * D) / MARLA <= 6 ? BED_BASE_SMALL : BED_BASE;
    const [got, need] = f === 'bedrooms' ? [share(['bed', 'master']), (base[nb] ?? 0.57) + 0.04]
      : f === 'lounge' ? [share(['lounge']), 0.20] : [share(['kitchen']), 0.10];
    add(got >= need ? 'ok' : 'warn', `bigger ${f}`, `${Math.round(got * 100)}% of built area, wanted ${Math.round(need * 100)}%`);
  }
  return out;
}

/** Reward in [0,1]: 0 if broken, otherwise the share of rule checks passed. */
export function score(checks) {
  if (checks.some((c) => c.level === 'err')) return 0;
  return checks.filter((c) => c.level === 'ok').length / checks.length;
}
