// Plot-size parsing and limits for the landing form. Plain regexes, no external service.
// The layout model was trained on plots 20-60 ft wide and 30-130 ft deep (3 to 34 marla), so the form keeps to that.
const SQFT_PER_MARLA = 225;
export const LIMITS = { wMin: 20, wMax: 60, dMin: 30, dMax: 130, marlaMin: 3, marlaMax: 34 };

const STD = { 3: [20, 34], 4: [25, 36], 5: [25, 45], 6: [30, 45], 7: [30, 52], 8: [30, 60], 10: [35, 65], 12: [40, 68], 14: [40, 80], 20: [50, 90] };
const WIDTHS = [20, 25, 27, 30, 35, 40, 45, 50, 55, 60];

const fmtMarla = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Typical plot width and depth in feet for a marla size (the usual plot shapes in Pakistan). */
export function dimsFor(marla) {
  const hit = Object.keys(STD).map(Number).find((k) => Math.abs(k - marla) < 0.01);
  if (hit) return { w: STD[hit][0], d: STD[hit][1] };
  const area = marla * SQFT_PER_MARLA;
  const target = Math.sqrt(area / 1.7);
  const w = WIDTHS.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  return { w, d: Math.round(area / w) };
}

/** "10 marla", "1 kanal", "30x60" -> { w, d, marla, label } or { error }. null when empty. */
export function parsePlot(text) {
  const t = text.toLowerCase().replace(/,/g, ' ').trim();
  if (!t) return null;
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:x|×|\*|by)\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const w = +m[1], d = +m[2];
    const err = feetError(w, d);
    if (err) return { error: err };
    const marla = (w * d) / SQFT_PER_MARLA;
    return { kind: 'feet', w, d, marla, label: `${w} x ${d} ft, about ${fmtMarla(Math.round(marla * 10) / 10)} marla` };
  }
  m = t.match(/(\d+(?:\.\d+)?)\s*(marla|kanal)/);
  if (m) {
    const n = +m[1];
    const marla = m[2] === 'kanal' ? n * 20 : n;
    if (marla < LIMITS.marlaMin || marla > LIMITS.marlaMax) return { error: `Naqsha plans plots from ${LIMITS.marlaMin} marla to ${LIMITS.marlaMax} marla (about 1.5 kanal).` };
    const { w, d } = dimsFor(marla);
    return { kind: m[2], w, d, marla, label: `${fmtMarla(marla)} marla, about ${Math.round(marla * SQFT_PER_MARLA).toLocaleString()} sq ft` };
  }
  return { error: 'Enter a size like 10 marla or 30x60.' };
}

/** Error text for a width/depth pair in feet, or '' when fine. */
export function feetError(w, d) {
  if (!Number.isFinite(w) || !Number.isFinite(d)) return 'Enter both the width and the depth.';
  if (w < LIMITS.wMin || w > LIMITS.wMax) return `Width should be ${LIMITS.wMin} to ${LIMITS.wMax} ft.`;
  if (d < LIMITS.dMin || d > LIMITS.dMax) return `Depth should be ${LIMITS.dMin} to ${LIMITS.dMax} ft.`;
  const marla = (w * d) / SQFT_PER_MARLA;
  if (marla < LIMITS.marlaMin || marla > LIMITS.marlaMax) return `That is ${fmtMarla(Math.round(marla * 10) / 10)} marla. Naqsha plans ${LIMITS.marlaMin} to ${LIMITS.marlaMax} marla.`;
  return '';
}

/** Most bedrooms that fit on one floor for a plot (found by probing the layout generator; same rule as tools/bands.py).
 *  The usable width after the side setbacks decides: 2 bedrooms up to 26 ft, 3 up to 32 ft, 4 up to 44 ft, then up to 6. */
export function maxBeds(w, d) {
  const marla = (w * d) / SQFT_PER_MARLA;
  if (marla <= 6) return 2;
  const side = marla <= 14 ? 3 : 5;
  const usable = w - 2 * side;
  return usable < 26 ? 2 : usable < 32 ? 3 : usable < 44 ? 4 : 6;
}

/** Whether a 'make bigger' choice can work on a plot (a bigger kitchen has almost no valid layouts up to 6 marla). */
export const focusAllowed = (id, marla) => !(id === 'kitchen' && marla != null && marla <= 6);

export const FOCUS = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'bedrooms', label: 'Bedrooms' },
  { id: 'lounge', label: 'Hall' },
  { id: 'kitchen', label: 'Kitchen' },
];

/** Washroom choices for a bedroom count: every bedroom attached, plus a guest washroom, plus a common one off the hall. */
export function bathOptions(beds) {
  return [
    { n: beds, label: 'Attached only', hint: `${beds} washrooms, one attached to each bedroom` },
    { n: beds + 1, label: '+ Guest', hint: `${beds + 1} washrooms: attached, plus a guest washroom by the drawing room` },
    { n: beds + 2, label: '+ Guest + common', hint: `${beds + 2} washrooms: attached, a guest washroom and a common one off the hall` },
  ];
}
