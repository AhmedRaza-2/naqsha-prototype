// Units the visitor measures in. Every plan is built in feet; this module only changes what is shown and typed.
// k = feet in one unit, ka = square feet in one square unit. 1 gaz = 1 yard = 3 ft, so a square gaz is 9 sq ft.
export const UNITS = {
  ft: { label: 'Feet', len: 'ft', area: 'sq ft', k: 1, ka: 1 },
  gaz: { label: 'Gaz (yards)', len: 'gaz', area: 'sq gaz', k: 3, ka: 9 },
  m: { label: 'Metres', len: 'm', area: 'sq m', k: 3.280839895, ka: 10.7639104 },
};
let cur = 'ft';
try { const s = localStorage.getItem('naqsha-unit'); if (UNITS[s]) cur = s; } catch { /* no storage */ }
export const getUnit = () => cur;
export function setUnit(u) {
  if (!UNITS[u]) return;
  cur = u;
  try { localStorage.setItem('naqsha-unit', u); } catch { /* no storage */ }
}
const trim = (v, dp) => { const s = v.toFixed(dp); return dp ? s.replace(/\.?0+$/, '') : s; };
/** feet -> the unit, as a plain number */
export const fromFt = (ft, u = cur) => ft / UNITS[u].k;
/** the unit -> feet, to the half foot (plans snap to half a foot) */
export const toFt = (v, u = cur) => Math.round((v * UNITS[u].k) * 2) / 2;
/** "12.5" for feet, "4.2" for gaz, "3.8" for metres: no unit word */
export const num = (ft, u = cur) => trim(fromFt(ft, u), u === 'ft' ? 1 : 1);
export const fmtLen = (ft, u = cur) => `${num(ft, u)} ${UNITS[u].len}`;
export const fmtArea = (sqft, u = cur) => { const v = sqft / UNITS[u].ka; return `${Math.round(v).toLocaleString()} ${UNITS[u].area}`; };

/** Re-express the "N ft", "N x M ft", "3-4 ft" and "N sq ft" in a sentence in the chosen unit. Other text is left alone. */
export function localize(str, u = cur) {
  if (u === 'ft' || !str) return str;
  const conv = (s, k) => s.replace(/\d+(?:\.\d+)?/g, (n) => trim(+n / k, 1));
  return String(str).replace(/((?:\d+(?:\.\d+)?\s*(?:[x×–-]\s*))*\d+(?:\.\d+)?)\s*(sq ft|sq\. ft|ft)\b/g, (m, nums, unit) => {
    const area = unit.startsWith('sq');
    const v = area ? nums.replace(/\d[\d,]*(?:\.\d+)?/g, (n) => String(Math.round(+n.replace(/,/g, '') / UNITS[u].ka))) : conv(nums, UNITS[u].k);
    return `${v} ${area ? UNITS[u].area : UNITS[u].len}`;
  });
}
/** "12' x 14'" in feet; "4 x 4.6 m" in metres and gaz (to the half foot first, then converted). */
export function dim(w, d, u = cur) {
  const h = (v) => Math.round(v * 2) / 2;
  if (u === 'ft') { const f = (v) => (Number.isInteger(h(v)) ? h(v) : h(v).toFixed(1)); return `${f(w)}' x ${f(d)}'`; }
  return `${num(h(w), u)} x ${num(h(d), u)} ${UNITS[u].len}`;
}
