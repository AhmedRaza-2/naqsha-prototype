// Automatic polish: a drafted plan that misses a rule by a little (a room half a foot too small, a setback a foot short)
// is nudged into shape. The same wall moves as the editor makes (half-foot steps) are tried one at a time, and a move
// is kept only when the rule checker scores the plan higher; a move that breaks a hard rule (a first floor's stairs
// leaving the stairs below, the bedroom count) is never kept. Plain local search, no model call.
import { wallHandles, applyEdit } from './editor.js';
import { score, OPEN } from './bands.js';
import { ruleFor } from './layout.js';

const STEPS = [0.5, 1, 1.5, 2, 3, 4];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** plan + checker -> { plan, checks, score, moves } with a better score, or null when no move helps. */
export function polish(plan, checkFn, { budgetMs = 250, maxMoves = 10, same = null } = {}) {
  let best = plan, bestChecks = checkFn(plan), bestScore = score(bestChecks), moves = 0;
  if (bestScore >= 1 || bestChecks.some((c) => c.level === 'err')) return null;
  const t0 = now();
  const key = (p) => JSON.stringify(p.tree || p.bands);
  while (moves < maxMoves && bestScore < 1) {
    let found = null;
    const base = key(best);
    for (const step of STEPS) {                                    // the smallest move that helps wins
      for (const h of wallHandles(best, true)) {
        for (const d of [step, -step]) {
          if (now() - t0 > budgetMs) break;
          const horiz = h.kind === 'row' || h.kind === 'bd';
          const cand = applyEdit(best, h, horiz ? 0 : d, horiz ? d : 0);
          if (key(cand) === base || (same && !same(cand))) continue;
          const cs = checkFn(cand);
          if (cs.some((c) => c.level === 'err')) continue;
          const sc = score(cs);
          if (sc > bestScore + 1e-9 && (!found || sc > found.sc)) found = { cand, cs, sc };
        }
      }
      if (found) break;
    }
    // no single move helps (fixing one rule breaks another): try two moves together, e.g. a deeper front lawn paid for
    // by a shallower back yard
    if (!found) {
      const hs = wallHandles(best, true);
      for (const step of STEPS.slice(0, 4)) {
        for (const h1 of hs) for (const d1 of [step, -step]) {
          if (now() - t0 > budgetMs) break;
          const h1z = h1.kind === 'row' || h1.kind === 'bd';
          const c1 = applyEdit(best, h1, h1z ? 0 : d1, h1z ? d1 : 0);
          if (key(c1) === base) continue;
          for (const h2 of wallHandles(c1, true)) for (const d2 of [step, -step]) {
            const h2z = h2.kind === 'row' || h2.kind === 'bd';
            const c2 = applyEdit(c1, h2, h2z ? 0 : d2, h2z ? d2 : 0);
            const k2 = key(c2);
            if (k2 === base || k2 === key(c1) || (same && !same(c2))) continue;
            const cs = checkFn(c2);
            if (cs.some((c) => c.level === 'err')) continue;
            const sc = score(cs);
            if (sc > bestScore + 1e-9 && (!found || sc > found.sc)) found = { cand: c2, cs, sc };
          }
        }
        if (found) break;
      }
    }
    if (!found) break;
    best = found.cand; bestChecks = found.cs; bestScore = found.sc; moves++;
  }
  return moves ? { plan: best, checks: bestChecks, score: bestScore, moves, ms: Math.round(now() - t0) } : null;
}

// ---------------------------------------------------------------- room sizes like real Pakistani plans
// Median areas (sq ft) of bedrooms, lounges, kitchens and drawing rooms in the 77 hand-transcribed real plans used for
// training (the 33 test plans are left out, so they can measure the effect), by plot size.
// The model's rooms come out smaller (bedrooms about 19%); refine() grows them toward these sizes, taking the space from
// passages, oversized yards and other slack, and keeps a move only if every rule the plan passed still passes.
export const REAL_MEDIAN = {
  small: { bed: 181, lounge: 201, kitchen: 105, drawing: 166 },    // up to 6 marla
  mid: { bed: 203, lounge: 217, kitchen: 136, drawing: 191 },      // 6 to 10 marla
  big: { bed: 232, lounge: 238, kitchen: 139, drawing: 206 },      // 10 to 14 marla
  kanal: { bed: 308, lounge: 290, kitchen: 203, drawing: 278 },    // above 14 marla
};
const sizeClass = (w, d) => { const m = (w * d) / 225; return m <= 6 ? 'small' : m <= 10 ? 'mid' : m <= 14 ? 'big' : 'kanal'; };
const TYPE = { bed: 'bed', master: 'bed', lounge: 'lounge', kitchen: 'kitchen', drawing: 'drawing' };

/** How far the plan's main rooms are from real sizes: 0 when every room is at least its real median (and not far above). */
export function sizeGap(rects, plot, own = null) {
  const T = REAL_MEDIAN[sizeClass(plot.w, plot.d)];
  let gap = 0;
  // unused yard: open space beyond what the rules (or the visitor) ask for is better spent on rooms. Large plots keep their
  // garden by design, so this only applies up to 12 marla, or whenever the visitor gave their own setbacks.
  if (own || plot.w * plot.d <= 12 * 225) {
    const mains = rects.filter((r) => !OPEN.has(r.t) && r.parent == null && r.t !== 'bath');
    if (mains.length) {
      const rl = own ? { ...ruleFor(plot.w, plot.d), ...own } : ruleFor(plot.w, plot.d);
      const x0 = Math.min(...mains.map((r) => r.x)), x1 = Math.max(...mains.map((r) => r.x + r.w));
      const y0 = Math.min(...mains.map((r) => r.y)), y1 = Math.max(...mains.map((r) => r.y + r.d));
      const slack = (v) => Math.max(0, v - 0.5);
      gap += 0.12 * (slack(y0 - rl.front) + slack(plot.d - y1 - rl.rear) + slack(x0 - rl.side) + slack(plot.w - x1 - rl.side));
    }
  }
  for (const r of rects) {
    if (r.t === 'passage' || r.t === 'lobby') {                    // circulation should not soak up the spare space
      const narrow = Math.min(r.w, r.d);
      if (r.t === 'passage' && narrow > 4.5) gap += 0.6 * (narrow - 4.5) / 4.5 * (Math.max(r.w, r.d) / 10);
      if (r.t === 'lobby' && r.w * r.d > 80) gap += 0.4 * (r.w * r.d - 80) / 80;
      continue;
    }
    const t = TYPE[r.t];
    if (!t || r.parent != null) continue;
    const a = r.w * r.d, want = T[t];
    if (a < want) gap += (want - a) / want;                        // too small: the main cost
    else if (a > want * 1.35) gap += 0.3 * (a - want * 1.35) / want;   // much too big: a little cost, so space is shared out
    const long = Math.max(r.w, r.d) / Math.max(1, Math.min(r.w, r.d));
    if (long > 1.7 && t !== 'lounge') gap += 0.5 * (long - 1.7);   // a bedroom 12 ft wide and 31 ft deep is a corridor, not a room
    else if (long > 2.1) gap += 0.5 * (long - 2.1);
  }
  return gap;
}

/** Grow undersized rooms toward real sizes without losing any rule. -> { plan, checks, gap0, gap, moves } or null. */
export function refine(plan, checkFn, toRects, { budgetMs = 250, maxMoves = 30, same = null } = {}) {
  let best = plan, bestChecks = checkFn(plan);
  if (bestChecks.some((c) => c.level === 'err')) return null;
  const keepScore = score(bestChecks);
  const gap0 = sizeGap(toRects(plan), plan.plot, plan.rule || null);
  let bestGap = gap0, moves = 0;
  if (gap0 < 0.05) return null;
  const t0 = now();
  const key = (p) => JSON.stringify(p.tree || p.bands);
  while (moves < maxMoves && now() - t0 < budgetMs) {
    let found = null;
    const base = key(best);
    for (const step of [0.5, 1, 2, 3]) {
      for (const h of wallHandles(best, true)) for (const d of [step, -step]) {
        if (now() - t0 > budgetMs) break;
        const hz = h.kind === 'row' || h.kind === 'bd';
        const cand = applyEdit(best, h, hz ? 0 : d, hz ? d : 0);
        if (key(cand) === base || (same && !same(cand))) continue;
        const g = sizeGap(toRects(cand), cand.plot, cand.rule || null);
        if (g >= bestGap - 0.01 || (found && g >= found.g)) continue;
        const cs = checkFn(cand);
        if (cs.some((c) => c.level === 'err') || score(cs) < keepScore - 1e-9) continue;
        found = { cand, cs, g };
      }
      if (found) break;
    }
    if (!found) break;
    best = found.cand; bestChecks = found.cs; bestGap = found.g; moves++;
  }
  return moves ? { plan: best, checks: bestChecks, gap0, gap: bestGap, moves, ms: Math.round(now() - t0) } : null;
}

/** The built outline and the stairs of a ground floor: what its first floor is drafted around. A two-storey ground
 *  floor keeps them while it is polished, so the first floor is asked for over the outline the model drew. */
export function outlineKey(rects) {
  const mains = rects.filter((r) => !OPEN.has(r.t) && r.parent == null && r.t !== 'bath');
  const st = mains.find((r) => r.t === 'stairs');
  const x0 = Math.min(...mains.map((r) => r.x)), y0 = Math.min(...mains.map((r) => r.y));
  const x1 = Math.max(...mains.map((r) => r.x + r.w)), y1 = Math.max(...mains.map((r) => r.y + r.d));
  return [x0, y0, x1, y1, st ? [st.x, st.y, st.w, st.d].join(',') : ''].join('|');
}
