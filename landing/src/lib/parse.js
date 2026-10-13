// Plot-size parsing for the landing form. Plain regexes, no external service.
// Accepts "10 marla", "1 kanal", "30x60", "30 x 60 ft", "7.5 marla".
const SQFT_PER_MARLA = 225;

export function parsePlot(text) {
  const t = text.toLowerCase().replace(/,/g, ' ').trim();
  if (!t) return null;
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:x|×|\*|by)\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const w = +m[1], d = +m[2];
    if (w < 15 || d < 25 || w > 150 || d > 250) return { error: 'That size looks off. Try something like 30x60.' };
    const marla = (w * d) / SQFT_PER_MARLA;
    return { kind: 'feet', w, d, marla, label: `${w} x ${d} ft, about ${fmtMarla(marla)} marla` };
  }
  m = t.match(/(\d+(?:\.\d+)?)\s*(marla|kanal)/);
  if (m) {
    const n = +m[1];
    const marla = m[2] === 'kanal' ? n * 20 : n;
    if (marla < 3 || marla > 60) return { error: 'Naqsha plans plots from 3 marla to 3 kanal.' };
    return { kind: m[2], marla, label: `${fmtMarla(marla)} marla, about ${Math.round(marla * SQFT_PER_MARLA).toLocaleString()} sq ft` };
  }
  return { error: 'Enter a size like 10 marla or 30x60.' };
}

function fmtMarla(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Most bedrooms that fit on one floor, from the validator-checked training data (small plots fit 2). */
export function maxBeds(marla) {
  if (marla <= 6) return 2;
  if (marla <= 14) return 4;
  return 6;
}
