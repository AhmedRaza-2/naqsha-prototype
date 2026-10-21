// Will it fit? A quick floor-space sum, so the form can grey out a room that would squeeze the others and say why,
// before the model is asked. The model and the rule check still have the last word; this only steers the choices.
import { ruleFor } from './layout.js';

// comfortable floor area of each room (sq ft). The first bedroom is the master and is larger.
const NEED = { bed: 110, master: 140, bath: 30, kitchen: 70, drawing: 110, lounge: 100, dining: 90, terrace: 70 };
const NAME = { drawing: 'drawing room', lounge: 'TV lounge', dining: 'dining room', terrace: 'terrace' };

/** Floor space of one floor, after the walls and passages, and after the stairs when there are two floors. */
export function floorSpace(w, d, twoFloors) {
  const r = ruleFor(w, d), area = Math.max(0, (w - 2 * r.side)) * Math.max(0, (d - r.front - r.rear));
  const stairs = twoFloors ? 60 : area > 1100 ? 45 : 0;
  return Math.max(0, Math.round(area * 0.9 - stairs));
}

/** Space the chosen rooms ask for. rooms: {drawing, lounge, dining, terrace} booleans; ground floors also hold the kitchen. */
export function need({ beds, baths, ground, ...rooms }) {
  let n = (beds > 0 ? NEED.master + (beds - 1) * NEED.bed : 0) + baths * NEED.bath + (ground ? NEED.kitchen : 0);
  for (const k of ['drawing', 'lounge', 'dining', 'terrace']) if (rooms[k]) n += NEED[k];
  return Math.round(n);
}

/**
 * What a floor can take. cfg: {w, d, twoFloors, ground, beds, baths, drawing, lounge, dining, terrace}.
 * Returns the space, what is asked, whether it fits, which unticked rooms would still fit if added (can), and a plain sentence for each problem.
 */
export function assess(cfg) {
  const space = floorSpace(cfg.w, cfg.d, cfg.twoFloors), want = need(cfg), fits = want <= space;
  const can = {};
  for (const k of ['drawing', 'lounge', 'dining', 'terrace']) can[k] = !!cfg[k] || need({ ...cfg, [k]: true }) <= space;
  const names = ['drawing', 'lounge', 'dining'].filter((k) => cfg[k]).map((k) => NAME[k]);
  const list = names.length ? ` with ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.slice(-1)}` : names[0]}` : '';
  const msgs = [];
  if (!fits) {
    const b = `${cfg.beds} bedroom${cfg.beds === 1 ? '' : 's'}${list} ask for about ${want} sq ft; this floor has about ${space} sq ft.`;
    msgs.push(`${b} Some rooms will come out small or the layout may not pass the checks. Take out a room or reduce the bedrooms.`);
  }
  // the biggest bedroom count this floor holds with the rooms already ticked
  let maxBeds = 0;
  for (let b = 1; b <= 6; b++) if (need({ ...cfg, beds: b, baths: b }) <= space) maxBeds = b;
  return { space, want, fits, can, maxBeds, msgs, name: NAME };
}

/** The reason a room is greyed out, as one sentence. */
export function whyNot(cfg, kind) {
  const a = assess(cfg), others = ['drawing', 'lounge', 'dining'].filter((k) => k !== kind && cfg[k]).map((k) => NAME[k]);
  return `A ${NAME[kind]} will not fit with ${cfg.beds} bedroom${cfg.beds === 1 ? '' : 's'}${others.length ? ` and the ${others.join(' and ')}` : ''} on this floor (about ${a.space} sq ft). Reduce the bedrooms${others.length ? ' or take out another room' : ''} to add it.`;
}
