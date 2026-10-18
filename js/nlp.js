// Reads a free-text request ("10 marla double storey 4 bed car porch, front setback 12 ft, no stairs") into the form's fields.
// English and Roman Urdu, numbers as digits or words, loose spelling. Nothing is sent anywhere: it is a set of patterns.
// parseRequest(text) -> { plot, beds, baths, floors, upBeds, focus, porch, family, setbacks, stairs, style, colors, notes, understood[] }
// Every field is only present when the text says something about it, so typing never overwrites what the visitor chose by hand.

const WORD_NUM = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  ek: 1, aik: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chay: 6, che: 6, saat: 7, aath: 8, nau: 9, das: 10, barah: 12, bara: 12, pandrah: 15, bees: 20,
};
const NUM = '(\\d+(?:\\.\\d+)?|' + Object.keys(WORD_NUM).join('|') + ')';
const num = (s) => (s == null ? null : /^\d/.test(s) ? parseFloat(s) : WORD_NUM[s]);

// standard Pakistani plot sizes (width x depth in feet), by marla
export const MARLA_PLOTS = {
  3: [20, 34], 4: [25, 36], 5: [25, 45], 6: [30, 45], 7: [30, 52], 8: [35, 51], 9: [35, 58], 10: [35, 65], 11: [40, 62], 12: [40, 68], 14: [45, 70], 15: [45, 75], 16: [50, 73], 20: [50, 90],
};
const MARLA = 225;

function plotFromArea(sqft) {
  const marla = sqft / MARLA;
  const rounded = Math.round(marla);
  if (Math.abs(marla - rounded) < 0.3 && MARLA_PLOTS[rounded]) return { w: MARLA_PLOTS[rounded][0], d: MARLA_PLOTS[rounded][1], marla };
  const w = Math.max(20, Math.round(Math.sqrt(sqft * 0.55) / 0.5) * 0.5 | 0), d = Math.round(sqft / w);
  return { w, d, marla };
}

export function parseRequest(raw) {
  const out = { understood: [], notes: [] };
  if (!raw || !raw.trim()) return out;
  let t = ' ' + raw.toLowerCase().replace(/[×✕]/g, 'x').replace(/[,;]+/g, ' , ').replace(/\s+/g, ' ') + ' ';
  const say = (label, value) => out.understood.push({ label, value });
  let m;

  // ---- plot: 35x65, 35 by 65, 35 ft wide 65 ft deep, 10 marla, 1 kanal, half kanal
  const unit = "(?:\\s*(?:ft|feet|foot|fit|'))?";
  if ((m = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)${unit}\\s*(?:x|\\*|by|bai|baee)\\s*(\\d+(?:\\.\\d+)?)${unit}`)))) {
    const a = +m[1], b = +m[2];
    if (a >= 15 && b >= 15 && a <= 250 && b <= 250) out.plot = { w: Math.min(a, b), d: Math.max(a, b), from: 'size' };      // the frontage is the shorter side
  }
  if (!out.plot) {
    const wide = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)${unit}\\s*(?:wide|width|front(?:age)?|chora|chaura)`)), deep = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)${unit}\\s*(?:deep|depth|long|length|lamba|lambai)`));
    if (wide && deep) out.plot = { w: +wide[1], d: +deep[1], from: 'size' };
  }
  if (!out.plot) {
    const kan = t.match(new RegExp(`(?:${NUM}\\s*)?(half|aadha|adha)?\\s*kana+l\\w*`));
    const mar = t.match(new RegExp(`${NUM}\\s*-?\\s*marl\\w*`));
    if (mar) {
      const n = num(mar[1]);
      if (n >= 2 && n <= 80) { const p = plotFromArea(n * MARLA); out.plot = { w: p.w, d: p.d, marla: n, from: 'marla' }; }
    } else if (kan && (kan[1] || kan[2] || /kanal/.test(t))) {
      const n = kan[2] ? 0.5 : (num(kan[1]) ?? 1);
      const p = n === 1 ? { w: 50, d: 90 } : n === 0.5 ? { w: 40, d: 56 } : plotFromArea(n * 20 * MARLA);
      out.plot = { w: p.w, d: p.d, marla: n * 20, from: 'kanal' };
    }
  }
  if (out.plot) say('Plot', out.plot.from === 'size' ? `${out.plot.w} x ${out.plot.d} ft` : `${out.plot.marla} marla, ${out.plot.w} x ${out.plot.d} ft`);

  // ---- floors
  const two = /\b(?:double|2|two|dual|g\s*\+\s*1|ground\s*(?:\+|plus)\s*(?:one|1)|do)\s*[- ]?\s*(?:stor(?:e)?y|storey|floor|floors|manzil\w*|mnzil\w*|mazil\w*)/.test(t) || /\bg\s*\+\s*1\b/.test(t) || /ground\s*(?:\+|plus)\s*(?:one|1)/.test(t) || /(?:upstairs|first floor|upper floor|upar)/.test(t) && /\d\s*(?:bed|kamr)/.test(t.replace(/.*(?:upstairs|first floor|upper floor|upar)/, ''));
  const one = /\b(?:single|1|one|ek|aik)\s*[- ]?\s*(?:stor(?:e)?y|storey|floor|manzil\w*)/.test(t);
  if (two) { out.floors = 2; say('Floors', 'two (ground + first)'); }
  else if (one) { out.floors = 1; say('Floors', 'one'); }

  // ---- bedrooms (digits or words, bed / bedroom / BHK / kamra); with two floors "3 downstairs 2 upstairs"
  const BED = '(?:bed\\w*|bdr\\w*|br\\b|bhk|kamr\\w*|kamre|kamray|rooms?)';
  const upM = t.match(new RegExp(`${NUM}\\s*${BED}?\\s*(?:up\\s*stairs|upstairs|upper|upar|first\\s*floor|on\\s*the\\s*first)`)) || t.match(new RegExp(`(?:up\\s*stairs|upstairs|upper|upar|first\\s*floor)\\s*[:\\-]?\\s*${NUM}\\s*${BED}`));
  const downM = t.match(new RegExp(`${NUM}\\s*${BED}?\\s*(?:down\\s*stairs|downstairs|ground|neeche|niche|lower)`)) || t.match(new RegExp(`(?:down\\s*stairs|downstairs|ground(?:\\s*floor)?|lower)\\s*[:\\-]?\\s*${NUM}\\s*${BED}`));
  if (upM) { const n = num(upM[1]); if (n >= 1 && n <= 4) { out.upBeds = n; if (!out.floors) { out.floors = 2; say('Floors', 'two (ground + first)'); } say('Bedrooms upstairs', String(n)); } }
  if (downM) { const n = num(downM[1]); if (n >= 1 && n <= 6) { out.beds = n; say(out.floors === 2 ? 'Bedrooms downstairs' : 'Bedrooms', String(n)); } }
  if (!out.beds) {
    const tt = t.replace(/\b\d+(?:\.\d+)?\s*(?:ft|feet|foot|')\s*(?:front|rear|back|side|sides|setback|left|right)\b/g, ' ');
    const bm = tt.match(new RegExp(`\\b${NUM}\\s*-?\\s*${BED}\\b`)) || tt.match(new RegExp(`${BED}\\s*[:=]\\s*${NUM}`));
    if (bm) {
      const n = num(bm[1]);
      if (n >= 1 && n <= 6 && !/^rooms?$/.test(bm[0].trim().split(/\s+/).pop() || '') || (n >= 1 && n <= 6 && /\d\s*rooms?/.test(bm[0]))) { out.beds = n; say('Bedrooms', String(n)); }
    }
  }

  // ---- washrooms
  const bathM = t.match(new RegExp(`${NUM}\\s*-?\\s*(?:attached\\s*)?(?:bath\\w*|washroom\\w*|wc|toilet\\w*|restroom\\w*|lavatory)`));
  if (bathM) { const n = num(bathM[1]); if (n >= 1 && n <= 10) { out.baths = n; say('Washrooms', String(n)); } }
  else if (/attached\s*(?:bath|washroom|toilet)/.test(t)) { out.bathsAttachedOnly = true; say('Washrooms', 'attached to each bedroom'); }

  // ---- bigger room
  if (/\b(?:big|bigger|large|larger|spacious|wide|badi|bara|baray)\w*\s+(?:hall|lounge|tv|drawing|living|sitting)/.test(t) || /\b(?:hall|lounge)\s+(?:big|large|bigger|spacious)/.test(t)) { out.focus = 'lounge'; say('Bigger', 'lounge'); }
  else if (/\b(?:big|bigger|large|larger|spacious|badi|bara|baray)\w*\s+(?:bed|room|master)/.test(t)) { out.focus = 'bedrooms'; say('Bigger', 'bedrooms'); }
  else if (/\b(?:big|bigger|large|larger|spacious|badi|bara)\w*\s+(?:kitchen|rasoi|bawarchi)/.test(t)) { out.focus = 'kitchen'; say('Bigger', 'kitchen'); }

  // ---- car porch
  if (/\b(?:no|without|bina|nahi|nahin)\s+(?:car\s*)?(?:porch|garage|parking|gari)/.test(t)) { out.porch = 'no'; say('Car porch', 'none'); }
  else if (/\b(?:car\s*porch|porch|garage|parking|gari|carport)\b/.test(t)) { out.porch = 'yes'; say('Car porch', 'yes'); }

  // ---- layout family
  const fam = { wing: /\b(?:wing|bedroom\s*wing)\b/, corridor: /\b(?:corridor|side\s*passage|passage\s*layout)\b/, compact: /\b(?:compact)\b/, rows: /\b(?:classic|rows|traditional\s*layout|simple\s*layout)\b/ };
  for (const [k, re] of Object.entries(fam)) if (re.test(t)) { out.family = k; say('Layout style', k); break; }

  // ---- setbacks: front 12 ft, 10 ft front, rear/back 5, sides 3, "no side setback"
  const sb = {};
  const sbUnit = "(?:\\s*(?:ft|feet|foot|'))?";
  const grab = (names) => {
    const a = t.match(new RegExp(`\\b(?:${names})\\b\\s*(?:setback|gap|open|space|chor\\w*|jagah)?\\s*(?:of|is|=|:)?\\s*${NUM}${sbUnit}`));
    const b = t.match(new RegExp(`${NUM}${sbUnit}\\s*\\b(?:${names})\\b(?:\\s*(?:setback|gap|open|space|chor\\w*|jagah))?`));
    const v = a ? num(a[1]) : b ? num(b[1]) : null;
    return v != null && v >= 0 && v <= 60 ? v : null;
  };
  const noSide = /\b(?:no|zero|0)\s*(?:ft\s*)?side\s*(?:setback|gap|space)/.test(t) || /\bside\s*(?:setback|gap)\s*(?:0|zero|nil)\b/.test(t);
  const f = grab('front|aage|samne'), r = grab('rear|back|peechay|piche|pichay'), s = grab('sides?|left|right|saide');
  if (f != null) sb.front = f;
  if (r != null) sb.rear = r;
  if (noSide) sb.side = 0; else if (s != null) sb.side = s;
  if (Object.keys(sb).length) { out.setbacks = sb; say('Open space', Object.entries(sb).map(([k, v]) => `${k === 'rear' ? 'back' : k} ${v} ft`).join(', ')); }

  // ---- roof stairs
  if (/\b(?:no|without|bina)\s*(?:roof\s*)?(?:stairs|seerhi|seedhi|zeena)\b/.test(t)) { out.stairs = 'none'; say('Stairs', 'none'); }
  else if (/\broof\s*(?:stairs|access)\b|\bstairs\s*(?:to|for)\s*(?:the\s*)?roof\b/.test(t)) { out.stairs = 'inside'; say('Stairs', 'to the roof'); }

  // ---- style and colours: "modern", "white house", "cream and brown"
  const styles = { modern: /\b(?:modern|minimal|contemporary|box)\b/, classic: /\b(?:classic|classical|traditional|colonial|elegant)\b/, spanish: /\b(?:mediterranean|spanish|tile|tiles|terracotta\s*roof|desi)\b/ };
  for (const [k, re] of Object.entries(styles)) if (re.test(t)) { out.style = k; say('Style', k); break; }
  const palette = { white: '#f3f1ec', cream: '#eadfca', beige: '#e6d9bf', sand: '#e2cfa9', grey: '#cfcfca', gray: '#cfcfca', sage: '#c9d1bf', green: '#c9d1bf', terracotta: '#d9a98a', brown: '#b8956a', yellow: '#ecd9a0', pink: '#e8c4bd', blue: '#c3d3df', orange: '#e3b58a', safed: '#f3f1ec' };
  const cm = t.match(new RegExp(`\\b(${Object.keys(palette).join('|')})\\b\\s*(?:colou?r|house|walls?|ghar|exterior|paint)?`));
  if (cm && /(?:colou?r|house|walls?|ghar|exterior|paint)/.test(cm[0] + t)) { out.colors = { wall: palette[cm[1]] }; say('Wall colour', cm[1]); }

  // ---- things the planner cannot place yet: say so instead of silently dropping them
  const unsupported = [['study', /\bstudy\b/], ['prayer room', /\b(?:prayer|namaz|masjid)\s*room|\bprayer\b/], ['servant quarter', /\bservant|quarter\b/], ['store room', /\bstore\s*room|\bstore\b/], ['basement', /\bbasement|tehkhana\b/], ['lift', /\blift|elevator\b/], ['garden', /\bgarden|lawn\s*area\b/], ['swimming pool', /\bpool\b/]];
  for (const [name, re] of unsupported) if (re.test(t)) out.notes.push(name);
  return out;
}
