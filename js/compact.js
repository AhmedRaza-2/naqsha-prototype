// Compact layouts for plots up to 6 marla: a port of generate_small() in tools/bands.py (the generator the model's
// training data comes from). Used as the planner's fallback on small plots when the model is not available, so a
// 4 marla plot never gets the stretched rule-based rooms. Every candidate is scored with the same checker (bands.js).
import { MARLA, ruleFor } from './layout.js';
import { check, score, parse } from './bands.js';

const MINSZ = { bed: 95, master: 110 };
const BEDS = new Set(['bed', 'master']);

const rnd = {
  uniform: (a, b) => a + Math.random() * (b - a),
  choice: (xs) => xs[Math.floor(Math.random() * xs.length)],
  int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
};
const r5 = (v) => Math.round(v * 2) / 2;
const down = (v) => Math.floor(v * 2) / 2;
const up = (v) => Math.ceil(v * 2) / 2;
const grid = (lo, hi) => { const a = Math.ceil(lo * 2 - 1e-9), b = Math.floor(hi * 2 + 1e-9); return b < a ? null : rnd.int(a, b) / 2; };
const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

export const isCompact = (w, d) => (w * d) / MARLA <= 6;

/** Band-format text of a plan (same as serialize() in tools/bands.py). */
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

function mirror(plan) {
  const p = JSON.parse(JSON.stringify(plan));
  for (const b of p.bands) {
    b.rooms.reverse();
    for (const r of b.rooms) if (r.bath) r.bath[2] = r.bath[2] === 'R' ? 'L' : 'R';
  }
  return p;
}

function once(W, D, beds, baths, focus) {
  const rule = ruleFor(W, D);
  const guest = baths >= beds + 1, common = baths >= beds + 2;
  const frontD = rule.front;
  const depth = D - frontD - rule.rear;
  const three = depth >= 31 && (beds === 2 || Math.random() < 0.5);
  if (beds === 2 && !three) return null;
  const porch = W >= 27 || (W >= 24 && Math.random() < (three ? 0.7 : 0.35));
  let opts = three
    ? [...(porch && beds === 2 ? ['porch'] : []), ...(beds === 1 || W >= 29 ? ['back'] : []), ...(!porch && beds === 2 ? ['front'] : [])]
    : ['back', ...(porch ? [] : ['front'])];
  if (!opts.length) return null;
  if (focus === 'lounge' && opts.length > 1 && opts.includes('porch')) opts = opts.filter((o) => o !== 'porch');
  const kpos = rnd.choice(opts);
  const kx = focus === 'kitchen' ? r5(rnd.uniform(2, 3)) : 0;

  // front row, entrance side on the left: [porch | kitchen] lobby [stairs] drawing
  const pw = porch ? grid(9, 11) : 0;
  const lw = grid(4.5, W >= 24 ? 5.5 : 5);
  let kf = 0;
  if (kpos === 'front') { kf = grid(6.5, Math.min(8 + kx, W - pw - lw - 9)); if (kf == null) return null; }
  const lob0 = pw + kf;
  let dw = W - lob0 - lw;
  const sf = dw > 15.5 || (dw >= 14 && Math.random() < 0.4) ? grid(3.5, 4) : 0;
  dw -= sf;
  if (dw < 9 || dw > 16) return null;
  const front = [...(porch ? [{ t: 'porch', w: pw }] : []), ...(kf ? [{ t: 'kitchen', w: kf }] : []), { t: 'lobby', w: lw },
    ...(sf ? [{ t: 'stairs', w: sf }] : []), { t: 'drawing', w: dw }];

  // row depths
  const slack = depth - (three ? 31 : 21.5);
  if (slack < 0) return null;
  const g = (lo, span) => r5(lo + rnd.uniform(0, Math.max(0, Math.min(span, slack * 0.45))));
  const fMin = Math.max(10.5, up(112 / dw));
  const f = focus === 'bedrooms' ? fMin : Math.max(g(10.5, 2.5), fMin);
  const m = three ? (focus === 'bedrooms' ? 10 : focus === 'lounge' ? r5(rnd.uniform(12, 13.5)) : g(10, 2)) : 0;
  const bWant = focus === 'bedrooms' ? 17 : r5(three ? rnd.uniform(11.5, 14) : rnd.uniform(12.5, 15));
  const builtMax = ((rule.cover / 100) * W * D + pw * f) / W;
  const b = Math.min(bWant, down(D - frontD - rule.rear - f - m), down(builtMax - f - m));
  if (b < (three ? 10.5 : 11)) return null;
  const rear = D - frontD - f - m - b;

  const bedBath = (r, d, side) => {
    for (const t of beds === 1 ? [r.t, 'bed'] : [r.t]) {
      for (const bb of [[r.w < 11.5 ? 4.5 : rnd.choice([5, 5.5]), Math.min(rnd.choice([6.5, 7, 7.5]), d - 3)], [4.5, Math.min(6.5, d - 3)]]) {
        if (r.w * d - bb[0] * bb[1] >= MINSZ[t] + 0.5) { r.t = t; return [...bb, side]; }
      }
    }
    return null;
  };

  let rows, lounge, loungeD;
  if (three) {
    const mid = [];
    let km = 0;
    if (kpos === 'porch') {
      km = grid(7, Math.min(pw, focus === 'lounge' ? 8 : 9.5 + kx, lob0 + lw - 3.5));
      if (km == null) return null;
      mid.push({ t: 'kitchen', w: km });
    }
    const sw = W >= 24 && !sf && focus !== 'lounge' && Math.random() < 0.6 ? grid(3.5, 4) : 0;
    const loungeW = W - km - sw;
    mid.push({ t: 'lounge', w: loungeW });
    if (sw) mid.push({ t: 'stairs', w: sw });
    const l0 = km, l1 = W - sw;
    if (loungeW < 9 || overlap(lob0, lob0 + lw, l0, l1) < 3.5) return null;
    let kb = 0;
    if (kpos === 'back') { kb = grid(Math.max(7, beds === 1 ? W - 15 : 7), (beds === 1 ? 10.5 : 9) + kx); if (kb == null) return null; }
    const rest = W - kb;
    let ws;
    if (beds === 2) { const a = grid(Math.max(10, rest - 16), Math.min(16, rest - 10)); if (a == null) return null; ws = [a, rest - a]; } else ws = [rest];
    if (Math.min(...ws) < 10 || Math.max(...ws) > 16) return null;
    let kind = beds === 2 ? ['master', 'bed'] : ['master'];
    if (beds === 2 && Math.random() < 0.5) { kind = kind.reverse(); ws = ws.reverse(); }
    const back = kind.map((t, i) => ({ t, w: ws[i] }));
    if (kb) back.splice(rnd.choice([0, back.length]), 0, { t: 'kitchen', w: kb });
    let x = 0;
    for (const r of back) { if (overlap(x, x + r.w, l0, l1) < 3.5) return null; x += r.w; }
    const shared = Math.random() < 0.7;
    const bedsBack = back.filter((r) => BEDS.has(r.t));
    for (const [i, r] of bedsBack.entries()) {
      let side = shared ? (i === 0 ? 'R' : 'L') : (i === 0 ? 'L' : 'R');
      if (bedsBack.length === 1) {
        const ki = back.findIndex((q) => q.t === 'kitchen');
        side = ki >= 0 ? (ki < back.indexOf(r) ? 'L' : 'R') : rnd.choice(['L', 'R']);
      }
      r.bath = bedBath(r, b, side);
      if (!r.bath) return null;
    }
    rows = [[f, front], [m, mid], [b, back]];
    lounge = km ? mid[1] : mid[0]; loungeD = m;
  } else {
    let kb = 0;
    if (kpos === 'back') kb = grid(6.5, (focus === 'lounge' ? 7 : 8.5) + kx);
    const hiB = focus === 'lounge' ? 11 : focus === 'bedrooms' ? 14 : 13, loB = focus === 'bedrooms' ? 12 : 10;
    let order, bw;
    if (kb) {
      order = rnd.choice([['kitchen', 'lounge', 'master'], ['master', 'lounge', 'kitchen']]);
      bw = grid(loB, Math.min(hiB, W - kb - 8.5));
    } else {
      order = rnd.choice([['lounge', 'master'], ['master', 'lounge']]);
      bw = grid(loB, Math.min(hiB, order[0] === 'lounge' ? W - Math.max(8.5, lob0 + 3.5) : lob0 + lw - 3.5));
    }
    if (bw == null) return null;
    const width = { kitchen: kb, lounge: W - kb - bw, master: bw };
    const back = order.map((t) => ({ t, w: width[t] }));
    let x = 0;
    for (const r of back) { if (r.t === 'lounge' && (r.w < 8.5 || overlap(x, x + r.w, lob0, lob0 + lw) < 3.5)) return null; x += r.w; }
    const bed = back.find((r) => r.t === 'master');
    bed.bath = bedBath(bed, b, order.indexOf('master') === 0 ? 'L' : 'R');
    if (!bed.bath) return null;
    rows = [[f, front], [b, back]];
    lounge = back.find((r) => r.t === 'lounge'); loungeD = b;
  }

  const drawing = front[front.length - 1];
  const loungeBath = () => [4.5, Math.min(rnd.choice([6, 6.5]), loungeD - 3), rnd.choice(['L', 'R'])];
  const loungeFits = (bb) => lounge.w >= 10 && lounge.w * loungeD - bb[0] * bb[1] >= 102;
  if (guest) {
    const gb = [4.5, Math.min(rnd.choice([6, 6.5]), f - 3), 'R'];
    const lb = loungeBath();
    if (dw * f - gb[0] * gb[1] >= 112) drawing.bath = gb;
    else if (!common && loungeFits(lb)) lounge.bath = lb;
    else return null;
  }
  if (common) {
    const lb = loungeBath();
    if (lounge.bath || !loungeFits(lb)) return null;
    lounge.bath = lb;
  }
  const plan = { plot: { w: W, d: D }, beds, baths, focus, bands: [{ d: frontD, rooms: [{ t: 'lawn', w: W }] },
    ...rows.map(([d, rooms]) => ({ d, rooms })), { d: rear, rooms: [{ t: 'void', w: W }] }] };
  return Math.random() < 0.5 ? mirror(plan) : plan;
}

/**
 * Draft compact plans for a small plot and keep the best distinct ones, in the same shape as draftPlans() in model.js:
 * [{ text, plan, checks, score }]. Relaxes the preferences (focus, then washrooms) if the exact request has no layout.
 */
export function compactPlans({ w, d, beds, baths, focus = 'balanced' }, { top = 3, tries = 600 } = {}) {
  const requests = [[baths, focus], [baths, 'balanced'], [beds, focus], [beds, 'balanced']];
  for (const [ba, fo] of requests) {
    const seen = new Set(), good = [];
    for (let i = 0; i < tries && good.length < 24; i++) {
      const p = once(w, d, beds, ba, fo);
      if (!p) continue;
      const text = serialize(p);
      if (seen.has(text)) continue;
      seen.add(text);
      const plan = parse(text);
      const checks = check(plan, beds);
      if (checks.some((c) => c.level === 'err')) continue;
      good.push({ text, plan, checks, score: score(checks) });
    }
    if (good.length) {
      good.sort((a, b) => b.score - a.score);
      return { items: good.slice(0, top), relaxed: ba !== baths || fo !== focus };
    }
  }
  return { items: [], relaxed: false };
}
