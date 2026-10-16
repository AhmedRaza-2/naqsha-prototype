// Slicing-tree plans in the browser: a port of tools/tree.py (verified against Python in tools/verify_js_port.py).
//   H 5 12.5 11 [lawn] [V 10 4.5 [porch] [lobby] [drawing +bath 4.5x6 R]] [V 8 [kitchen] [lounge]] [void]
// H stacks its parts from the road to the back, V places them left to right; every cut lists the sizes of all parts
// but the last, which takes what is left. A leaf is a room (optionally `+bath WxD L|R`); a `bath` leaf is a washroom of
// its own and belongs to the neighbouring room it shares the longest wall with (a bedroom if there is one).
import { OPEN, BEDS, MARLA_SQFT, FOCUS_VALUES, checkRects, checkUpper, shared, family, score, parse as parseRows, check as checkRows, toRects as rowsToRects } from './bands.js';

const LEAF_TYPES = new Set([...OPEN, ...BEDS, 'bath', 'kitchen', 'lounge', 'drawing', 'dining', 'stairs', 'store', 'lobby', 'passage', 'prayer', 'study', 'servant', 'dress', 'other']);
const TOK = /\[|\]|\+bath|[A-Za-z_]+|\d+(?:\.\d+)?x\d+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const NUM = /^\d+(?:\.\d+)?$/;
const fmt = (v) => String(Math.round(v * 100) / 100);

// ---------------------------------------------------------------- text
export function toText(node) {
  if (node.k === 'room') return node.bath ? `${node.t} +bath ${fmt(node.bath[0])}x${fmt(node.bath[1])} ${node.bath[2]}` : node.t;
  return `${node.k} ${node.sizes.map(fmt).join(' ')} ${node.kids.map((c) => `[${toText(c)}]`).join(' ')}`;
}

/** The request line. A first floor names the ground floor's built box and its stairs (inside the box), which it must
 *  keep: PLOT 35x65 FLOOR 1 BOX 3 12 29 43 UP 0 0 8 12.5 BEDS 3 BATHS 3. The ground floor of a two-storey house says
 *  STOREYS 2 (it must have stairs). Same as header in tools/tree.py. */
export function header(plan) {
  let head = `PLOT ${fmt(plan.plot.w)}x${fmt(plan.plot.d)}`;
  if (plan.floor) {
    const b = plan.box, u = plan.up;
    head += ` FLOOR 1 BOX ${[b.x, b.y, b.w, b.d].map(fmt).join(' ')} UP ${[u.x, u.y, u.w, u.d].map(fmt).join(' ')}`;
  }
  head += ` BEDS ${plan.beds}`;
  if (plan.baths != null) head += ` BATHS ${plan.baths}`;
  if (plan.focus) head += ` FOCUS ${plan.focus}`;
  if (plan.storeys) head += ` STOREYS ${plan.storeys}`;
  if (plan.style) head += ` STYLE ${plan.style}`;
  if (plan.src) head += ` SRC ${plan.src}`;
  return head;
}

export function serialize(plan) {
  return `${header(plan)}\n${toText(plan.floor ? unwrap(plan) : plan.tree)}`;
}

// ---------------------------------------------------------------- first floors
/** A first floor is written inside the ground floor's built box; for geometry, checks and the editor it is placed on the
 *  plot with open air (void) around the box. Same as wrap in tools/tree.py. */
export function wrap(W, D, box, local) {
  const cut = (k, before, size, total, kid) => {
    const after = Math.round((total - before - size) * 100) / 100;
    const sizes = [], kids = [];
    if (before > 0.01) { sizes.push(before); kids.push({ k: 'room', t: 'void' }); }
    kids.push(kid);
    if (after > 0.01) { sizes.push(size); kids.push({ k: 'room', t: 'void' }); }
    return kids.length === 1 ? kid : { k, sizes, kids };
  };
  return cut('H', box.y, box.d, D, cut('V', box.x, box.w, W, local));
}

/** The box-local tree of a first floor (inverse of wrap). */
export function unwrap(plan) {
  const { w: W, d: D } = plan.plot, b = plan.box;
  let t = plan.tree;
  if (b.y > 0.01 || D - b.y - b.d > 0.01) t = t.kids[b.y > 0.01 ? 1 : 0];
  if (b.x > 0.01 || W - b.x - b.w > 0.01) t = t.kids[b.x > 0.01 ? 1 : 0];
  return t;
}

function parseNode(toks, i) {
  const t = toks[i];
  if (t === 'H' || t === 'V') {
    i += 1;
    const sizes = [];
    while (i < toks.length && NUM.test(toks[i])) sizes.push(parseFloat(toks[i++]));
    const kids = [];
    while (i < toks.length && toks[i] === '[') {
      const [kid, j] = parseNode(toks, i + 1);
      if (toks[j] !== ']') throw new Error('missing ]');
      kids.push(kid); i = j + 1;
    }
    if (kids.length < 2 || kids.length !== sizes.length + 1) throw new Error(`${t}: ${sizes.length} sizes for ${kids.length} parts`);
    return [{ k: t, sizes, kids }, i];
  }
  if (/^[A-Za-z_]+$/.test(t || '')) {
    const node = { k: 'room', t };
    i += 1;
    if (toks[i] === '+bath') {
      const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(toks[i + 1] || '');
      const side = toks[i + 2];
      if (!m || (side !== 'L' && side !== 'R')) throw new Error('bad +bath');
      node.bath = [parseFloat(m[1]), parseFloat(m[2]), side];
      i += 3;
    }
    return [node, i];
  }
  throw new Error(`unexpected token ${t}`);
}

const N = String.raw`(\d+(?:\.\d+)?)`;
const HEAD = new RegExp(String.raw`^PLOT ${N}x${N}(?: FLOOR 1 BOX ${N} ${N} ${N} ${N} UP ${N} ${N} ${N} ${N})? BEDS (\d+)(?: BATHS (\d+))?`
  + String.raw`(?: FOCUS ([a-z]+))?(?: STOREYS (\d))?(?: STYLE ([a-z]+))?(?: SRC ([a-z]+))?$`);

/** Text -> plan { plot, beds, baths, focus, storeys, style, src, tree } (+ floor, box, up for a first floor). Throws on
 *  malformed text. */
export function parse(text) {
  const nl = text.indexOf('\n');
  const head = (nl < 0 ? text : text.slice(0, nl)).trim();
  const m = head.match(HEAD);
  if (!m || nl < 0) throw new Error('bad header');
  const toks = text.slice(nl + 1).match(TOK) || [];
  const [tree, i] = parseNode(toks, 0);
  if (i !== toks.length) throw new Error('trailing tokens');
  const W = parseFloat(m[1]), D = parseFloat(m[2]);
  const plan = { plot: { w: W, d: D }, beds: parseInt(m[11], 10), tree };
  if (m[3] !== undefined) {
    const [bx, by, bw, bd, ux, uy, uw, ud] = m.slice(3, 11).map(parseFloat);
    if (bw <= 0 || bd <= 0 || bx + bw > W + 0.01 || by + bd > D + 0.01) throw new Error('box outside the plot');
    plan.floor = 1;
    plan.box = { x: bx, y: by, w: bw, d: bd };
    plan.up = { x: ux, y: uy, w: uw, d: ud };
    plan.tree = wrap(W, D, plan.box, tree);
  }
  if (m[12] !== undefined) plan.baths = parseInt(m[12], 10);
  if (m[13] !== undefined) plan.focus = m[13];
  if (m[14] !== undefined) plan.storeys = parseInt(m[14], 10);
  if (m[15] !== undefined) plan.style = m[15];
  if (m[16] !== undefined) plan.src = m[16];
  return plan;
}

// ---------------------------------------------------------------- geometry
function layout(node, x, y, w, d, out, errs) {
  if (node.k === 'room') { out.push({ t: node.t, x, y, w, d, bath: node.bath || null }); return; }
  const total = node.k === 'H' ? d : w;
  const rest = Math.round((total - node.sizes.reduce((s, v) => s + v, 0)) * 100) / 100;
  if (rest <= 0 || Math.min(...node.sizes) <= 0) errs.push(`${node.k} cut: sizes ${node.sizes.join(',')} do not fit ${total}`);
  let pos = 0;
  [...node.sizes, rest].forEach((s, k) => {
    if (node.k === 'H') layout(node.kids[k], x, y + pos, w, s, out, errs);
    else layout(node.kids[k], x + pos, y, s, d, out, errs);
    pos += s;
  });
}

export function leaves(plan) {
  const out = [], errs = [];
  layout(plan.tree, 0, 0, plan.plot.w, plan.plot.d, out, errs);
  return { rooms: out, errs };
}

/** Layout family read from the geometry, not from the requested STYLE tag (the model does not always follow it): see
 *  family in bands.js. Same as family_of in tools/tree.py. */
export function familyOf(plan, rects) {
  return family(plan, rects || toRects(plan));
}

/** Same rectangles as bands.toRects: rooms first, then washrooms (overlay or standalone) with parent = room index. */
export function toRects(plan) {
  const { rooms } = leaves(plan);
  const rects = rooms.filter((r) => r.t !== 'bath').map((r, k) => ({ i: k, t: r.t, x: r.x, y: r.y, w: r.w, d: r.d, band: 0, bath: r.bath }));
  const out = [...rects];
  for (const r of rects) {
    if (r.bath) {
      const [bw, bd, side] = r.bath;
      out.push({ i: out.length, t: 'bath', parent: r.i, band: 0, bath: null, x: side === 'R' ? r.x + r.w - bw : r.x, y: r.y + r.d - bd, w: bw, d: bd });
    }
  }
  for (const b of rooms.filter((r) => r.t === 'bath')) {                 // a washroom of its own: belongs to its best neighbour
    let best = null, key = null;
    for (const r of rects) {
      if (OPEN.has(r.t)) continue;
      const s = shared(b, r);
      if (!s) continue;
      const k = [BEDS.has(r.t) ? 1 : 0, s[3] - s[2]];
      if (!key || k[0] > key[0] || (k[0] === key[0] && k[1] > key[1])) { best = r; key = k; }
    }
    if (best && BEDS.has(best.t)) best.ensuite = true;
    out.push({ i: out.length, t: 'bath', parent: best ? best.i : -1, band: 0, bath: null, x: b.x, y: b.y, w: b.w, d: b.d, own: true });
  }
  return out;
}

export function check(plan, beds = plan.beds) {
  const out = [];
  const add = (level, name, detail = '') => out.push({ level, name, detail });
  const { rooms, errs: gerr } = leaves(plan);
  let errs = 0;
  for (const e of gerr) { add('err', 'cut sizes', e); errs++; }
  for (const r of rooms) {
    if (!LEAF_TYPES.has(r.t)) { add('err', 'room type', `unknown type ${r.t}`); errs++; }
    if (r.bath) {
      const [bw, bd] = r.bath;
      if (r.t === 'bath' || bw > r.w - 1 || bd > r.d - 2) { add('err', 'bath fit', `bath ${bw}x${bd} too big for ${r.t}`); errs++; }
    }
  }
  if (plan.focus != null && !FOCUS_VALUES.includes(plan.focus)) { add('err', 'focus value', String(plan.focus)); errs++; }
  if (errs) return out;
  const rects = toRects(plan);
  if (rects.some((r) => r.own && r.parent < 0)) { add('err', 'bath fit', 'washroom next to no room'); errs++; }
  if (plan.floor) return checkUpper(plan, rects, beds, out, errs);
  return checkRects(plan, rects, beds, out, errs);
}

// ---------------------------------------------------------------- both languages
/** True when the plan after the prompt line is a slicing tree (not rows of rooms). */
export function isTree(text) {
  const body = text.includes('\n') ? text.slice(text.indexOf('\n') + 1).trimStart() : '';
  return body[0] === 'H' || body[0] === 'V' || (!!body && !body.includes(':'));
}

/** Any plan text -> { plan, checks, rects, kind }. Throws on malformed text. */
export function parseAny(text, beds) {
  if (isTree(text)) {
    const plan = parse(text);
    return { plan, checks: check(plan, beds ?? plan.beds), rects: toRects(plan), kind: 'tree' };
  }
  const plan = parseRows(text);
  return { plan, checks: checkRows(plan, beds ?? plan.beds), rects: rowsToRects(plan), kind: 'rows' };
}

export { score };
