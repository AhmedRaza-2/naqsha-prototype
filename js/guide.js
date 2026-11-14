// Guided questions: the request is built one short question at a time ("What is your plot size?", "One floor or two?", ...).
// Short answers are what speech recognition gets right (a number, a size, one word), and every question can also be answered by
// tapping, so nothing depends on the microphone. parseShort() reads one short answer, spoken or typed, in English or Roman Urdu.
import { parseRequest, MARLA_PLOTS } from './nlp.js';

const WORDS = { zero: 0, none: 0, no: 0, nil: 0, nahi: 0, nahin: 0, one: 1, ek: 1, aik: 1, single: 1, two: 2, to: 2, too: 2, do: 2, double: 2, three: 3, tree: 3, teen: 3, triple: 3, four: 4, for: 4, char: 4, chaar: 4, five: 5, panch: 5, paanch: 5, six: 6, chay: 6, che: 6, seven: 7, saat: 7, eight: 8, aath: 8, nine: 9, nau: 9, ten: 10, das: 10 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** The first whole number in a short answer: digits or words ("four", "chaar", "thirty five"). null when there is none. */
export function numberIn(text) {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z0-9. ]/g, ' ')} `;
  const d = /(\d+(?:\.\d+)?)/.exec(t);
  if (d) return parseFloat(d[1]);
  const tens = /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\s+(one|two|three|four|five|six|seven|eight|nine))?\b/.exec(t);
  if (tens) return TENS[tens[1]] + (tens[2] ? WORDS[tens[2]] : 0);
  for (const w of t.split(/\s+/)) if (w in WORDS) return WORDS[w];
  return null;
}

/** One short answer to question `kind` ('plot' | 'floors' | 'beds' | 'cars') -> the value, or null when it was not understood. */
export function parseShort(kind, text) {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z0-9.+ ]/g, ' ').replace(/\s+/g, ' ')} `;
  if (kind === 'plot') {
    const r = parseRequest(text);
    if (r.plot) return { w: r.plot.w, d: r.plot.d, label: r.plot.from === 'size' ? `${r.plot.w} x ${r.plot.d} ft` : `${r.plot.marla} marla` };
    const n = numberIn(text);                                       // a bare number is marla ("ten", "seven and a half" is not read)
    if (n && n >= 2 && n <= 80 && MARLA_PLOTS[Math.round(n)]) { const [w, d] = MARLA_PLOTS[Math.round(n)]; return { w, d, label: `${Math.round(n)} marla` }; }
    return null;
  }
  if (kind === 'floors') {
    if (/\b(?:two|2|double|dual|do|duplex|g\s*\+\s*1|first|upstairs|upar|manzil\s*do)\b/.test(t) && !/\b(?:one|single|ek|aik|1)\s*(?:floor|storey|story|manzil)\b/.test(t)) return 2;
    if (/\b(?:one|1|single|ek|aik|ground|only)\b/.test(t)) return 1;
    return null;
  }
  const n = numberIn(text);
  if (kind === 'beds') return n != null && n >= 1 && n <= 8 ? n : null;
  if (kind === 'cars') return n != null && n >= 0 && n <= 6 ? n : null;
  return null;
}

/** The questions, in order. `known(fields)` is true when the sentence or the form already answered it. */
export const QUESTIONS = [
  { k: 'plot', q: 'What is your plot size?', say: 'Say it like "ten marla" or "thirty by sixty".', chips: [['5 marla', { w: 25, d: 45 }], ['7 marla', { w: 30, d: 50 }], ['10 marla', { w: 35, d: 65 }], ['1 kanal', { w: 50, d: 90 }]] },
  { k: 'floors', q: 'One floor or two?', say: 'Say "one floor" or "two floors".', chips: [['One floor', 1], ['Two floors', 2]] },
  { k: 'beds', q: 'How many bedrooms?', say: 'Say a number, like "three".', chips: [2, 3, 4, 5, 6].map((n) => [String(n), n]) },
  { k: 'cars', q: 'How many cars do you want to park?', say: 'Say a number, like "two", or "none".', chips: [['None', 0], ['1', 1], ['2', 2], ['3', 3]] },
];
