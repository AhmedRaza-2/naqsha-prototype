// Constrained decoding for the layout model. The model writes a plan as a slicing tree, one token at a time:
//     H 12 13 15 [V 13 11 [lawn] [porch] [lawn]] [V 3 12.5 [void] [drawing +bath 4.5x7 R] [bed]] [lounge]
// Left to itself it often writes a tree that cannot be the plan that was asked for: a cut with four sizes and six parts, a
// bracket never closed, three bedrooms where four were asked, a two-storey house without stairs, a first floor whose
// stairs are not above the stairs below. A Guide follows the tree as it is written (it knows the rectangle of every
// part) and, before every token is picked, says which tokens can still lead to a plan that is well-formed and meets
// the request:
//   form      a cut with n sizes has exactly n + 1 parts; its sizes stay inside the piece of plot it divides; a room is
//             one word, optionally "+bath AxB L|R"; the plan ends only when every bracket is closed
//   bedrooms  never more than asked; and when the parts still to be written are only just enough for the bedrooms (and
//             the stairs) still missing, each of them must be one of those, or a cut that makes more parts
//   washrooms never more than asked, only in rooms that take one, no bigger than the room allows; a room must take one
//             when there are more washrooms left than bedrooms to come
//   stairs    a two-storey ground floor has one; on a first floor no cut may cross the stairs of the floor below, a part
//             that holds them must be cut until it is exactly their rectangle, and that part (and no other) is the stairs
// The model still chooses among the tokens that are left, with its own probabilities: the guide only removes what cannot work.

const MIN_PART = 1;                                                // feet left for a cut's last part
const EPS = 0.011;
// words of the vocabulary that are not rooms: the request line's own words, focus and family names, the washroom marker
const HEADER = new Set(['PLOT', 'FLOOR', 'BOX', 'UP', 'BEDS', 'BATHS', 'FOCUS', 'STOREYS', 'STYLE', 'SRC', 'H', 'V', 'L', 'R', 'x', 'rest', 'balanced', 'bedrooms', 'rows', 'compact', 'corridor', 'wing', 'world', 'pk']);
const BATH_HOST = new Set(['bed', 'master', 'drawing', 'lounge']);
// the least a room can be (its shorter side, ft): the guide never writes one into a strip of open space
const MIN_SIDE = { bed: 7, master: 8, drawing: 7, lounge: 7, kitchen: 5, dining: 6, stairs: 3, bath: 3.5 };
const UPPER_NOT = new Set(['drawing', 'porch', 'garage', 'lawn', 'courtyard']);      // rooms that belong on the ground floor (bands.js)

/** Token classes of a vocabulary, worked out once. */
export function tokenTable(vocab) {
  const T = vocab.tokens, n = T.length;
  const val = new Float64Array(n).fill(NaN), room = new Uint8Array(n);
  const id = {};
  T.forEach((t, i) => {
    if (/^\d+(?:\.\d+)?$/.test(t)) val[i] = parseFloat(t);
    else if (/^[a-z_]+$/.test(t) && !HEADER.has(t)) room[i] = 1;
    if (['[', ']', 'H', 'V', '+', 'x', 'L', 'R', 'bath', 'bed', 'master', 'stairs', 'kitchen', 'drawing', 'lounge', 'terrace'].includes(t)) id[t] = i;
  });
  return { n, val, room, id, eos: vocab.eos, name: T };
}

export class Guide {
  /** tt: tokenTable(vocab); rect { w, d }: what the tree divides (the plot, or the built box of a first floor);
   *  req { beds, baths, stairs: a two-storey ground floor, up: { x, y, w, d } the stairs below (first floors) }. */
  constructor(tt, rect, req = {}) {
    this.tt = tt; this.w = rect.w; this.d = rect.d; this.req = req;
    this.stack = [];                                                // open cuts: { k, x, y, w, d, ext, sizes, sum, kids, touched }
    this.state = 'start';
    this.leaf = null;                                               // the room being written: { t, w, d, stage, bw }
    this.beds = 0; this.baths = 0; this.stairs = 0; this.kitchen = 0; this.drawing = 0; this.lounge = 0;
    this.hurry = false;                                             // set when the writer is running out of room: no new cuts, no more sizes, no washrooms
    this.ok = true;                                                 // false once the model wrote something the guide does not know: it then stands aside
  }

  /** The rectangle of the next part of the cut on top of the stack. */
  partRect() {
    const f = this.stack[this.stack.length - 1], i = f.kids;
    let off = 0; for (let j = 0; j < i; j++) off += f.sizes[j];
    const s = i < f.sizes.length ? f.sizes[i] : f.ext - f.sum;
    return f.k === 'H' ? { x: f.x, y: f.y + off, w: f.w, d: s } : { x: f.x + off, y: f.y, w: s, d: f.d };
  }
  /** How a rectangle stands to the stairs below: 'same', 'holds' (they are inside it, with room to spare), 'apart' or 'cuts' (overlaps part of them). */
  upIn(r) {
    const u = this.req.up;
    if (!u) return 'apart';
    const ox = Math.min(r.x + r.w, u.x + u.w) - Math.max(r.x, u.x), oy = Math.min(r.y + r.d, u.y + u.d) - Math.max(r.y, u.y);
    if (ox <= EPS || oy <= EPS) return 'apart';
    const inside = u.x >= r.x - EPS && u.y >= r.y - EPS && u.x + u.w <= r.x + r.w + EPS && u.y + u.d <= r.y + r.d + EPS;
    if (!inside) return 'cuts';
    return Math.abs(r.w - u.w) < EPS && Math.abs(r.d - u.d) < EPS ? 'same' : 'holds';
  }
  /** The stairs' span along a cut's axis, from the cut's own start: [lo, hi], or null when the cut's rectangle does not hold them. */
  upSpan(f) {
    const u = this.req.up;
    if (!u || this.upIn(f) !== 'holds') return null;
    return f.k === 'H' ? [u.y - f.y, u.y + u.d - f.y] : [u.x - f.x, u.x + u.w - f.x];
  }
  /** Parts already promised by the open cuts but not written yet, after the one being decided now. A part of the outermost
   *  cut is usually a whole row of rooms, so it counts for three: the guide only steps in when the plan is really running out of places. */
  slotsAfter() { let n = 0; this.stack.forEach((f, i) => { n += (f.sizes.length + 1 - f.kids - 1) * (i === 0 && !this.hurry ? 3 : 1); }); return n; }
  /** Rooms the request still needs: the bedrooms, and on a ground floor a kitchen, a drawing room and (two storeys) the stairs. */
  needed() {
    const q = this.req, ground = !q.up;
    return Math.max(0, (q.beds ?? 0) - this.beds) + (q.stairs && !this.stairs ? 1 : 0) + (ground && q.must && !this.kitchen ? 1 : 0) + (ground && q.must && !this.drawing ? 1 : 0) + (q.lounge && !this.lounge ? 1 : 0);
  }
  required(t) {
    const { id } = this.tt, q = this.req;
    return ((t === id.bed || t === id.master) && this.beds < (q.beds ?? 0)) || (t === id.stairs && q.stairs && !this.stairs)
      || (!q.up && q.must && ((t === id.kitchen && !this.kitchen) || (t === id.drawing && !this.drawing)))
      || (q.lounge && t === id.lounge && !this.lounge);                // a hall the rooms open from: without one the kitchen becomes the passage
  }

  /** May token `t` come next? */
  allows(t) {
    const { val, room, id, eos } = this.tt;
    if (!this.ok) return true;
    const f = this.stack[this.stack.length - 1];
    switch (this.state) {
      case 'start': return t === id.H || t === id.V;
      case 'sizes': {
        const span = this.upSpan(f);
        if (t === id['[']) return f.sizes.length >= 1 && (!span || f.touched);
        const v = val[t];
        if (!(v > 0) || f.sizes.length >= 9 || f.sum + v > f.ext - MIN_PART + 1e-6) return false;
        if (span) {                                                 // a cut line never crosses the stairs below, and one of them runs along their edge
          const pos = f.sum + v, [lo, hi] = span;
          if (pos > lo + EPS && pos < hi - EPS) return false;
          if (!f.touched && pos > lo + EPS && Math.abs(pos - hi) > EPS) return false;        // went past their near edge without stopping on it: only their far edge will do
          if (!f.touched && lo < EPS && Math.abs(pos - hi) > EPS) return false;
          if (!f.touched && this.hurry && Math.abs(pos - lo) > EPS && Math.abs(pos - hi) > EPS) return false;
          return true;
        }
        return !(this.hurry && f.sizes.length >= 1);
      }
      case 'parts':
        if (f.kids < f.sizes.length + 1) return t === id['['];
        return this.stack.length > 1 ? t === id[']'] : t === eos;
      case 'open': {
        const r = this.partRect(), rel = this.upIn(r), cut = t === id.H || t === id.V;
        if (rel === 'same') return t === id.stairs;                 // exactly over the stairs below: this is the stairs
        if (rel === 'holds' || rel === 'cuts') {                    // the stairs are somewhere inside: cut again, along a side that is longer than theirs
          if (!cut) return false;
          const u = this.req.up;
          return t === id.H ? r.d > u.d + EPS : r.w > u.w + EPS;
        }
        const need = this.needed(), after = this.slotsAfter();
        if (cut) {
          if (this.stack.length >= 7 || (t === id.H ? r.d : r.w) < 2 * MIN_PART + 1) return false;      // a cut needs something to divide
          return !this.hurry || (need > after + 1 && Math.min(r.w, r.d) >= 7);      // out of room: a new cut only when the rooms still missing cannot fit otherwise
        }
        if (room[t] !== 1) return false;
        if (this.req.up ? (t === id.stairs || UPPER_NOT.has(this.tt.name[t])) : t === id.terrace) return false;      // a first floor has its stairs only over the stairs below, and no ground-floor rooms; a terrace is a first-floor thing
        if ((t === id.bed || t === id.master) && this.req.beds != null && this.beds >= this.req.beds) return false;
        if (t === id.stairs && this.stairs >= 1) return false;
        if (t === id.bath && this.req.baths != null && this.baths >= this.req.baths) return false;
        const side = MIN_SIDE[this.tt.name[t]];
        if (side && Math.min(r.w, r.d) < side) return false;         // too thin for this room
        const fits = Math.min(r.w, r.d) >= 7;                        // a missing room is only asked for where a room can go, never in an open strip
        if (fits && need > 0 && need >= after + 1) return this.required(t);   // the places left are only just enough: this one must be a room still missing
        return true;
      }
      case 'leaf': {
        const L = this.leaf, q = this.req;
        if (L.stage === 0) {
          const host = BATH_HOST.has(L.t) && L.w - 1 >= 3.5 && L.d - 2 >= 3.5 && !(this.req.up && L.t === 'drawing'), left = q.baths != null ? q.baths - this.baths : 0;
          const must = host && (L.t === 'bed' || L.t === 'master') && q.baths != null && !this.hurry && left > Math.max(0, (q.beds ?? 0) - this.beds);     // a bedroom must take one when more washrooms are left than bedrooms to come
          if (t === id[']']) return !must;
          return t === id['+'] && host && !this.hurry && (q.baths == null || left > 0);
        }
        if (L.stage === 1) return t === id.bath;
        if (L.stage === 2) return val[t] >= 3 && val[t] <= L.w - 1 + 1e-6;
        if (L.stage === 3) return t === id.x;
        if (L.stage === 4) return val[t] >= 3 && val[t] <= L.d - 2 + 1e-6;
        if (L.stage === 5) return t === id.L || t === id.R;
        return t === id[']'];
      }
      default: return t === eos;                                    // 'done'
    }
  }

  /** Token `t` was written. */
  push(t) {
    if (!this.ok) return;
    const { val, id, name } = this.tt;
    const f = this.stack[this.stack.length - 1];
    const closePart = () => { const p = this.stack[this.stack.length - 1]; p.kids += 1; this.state = 'parts'; };
    const cutOf = (k, r) => ({ k, x: r.x, y: r.y, w: r.w, d: r.d, ext: k === 'H' ? r.d : r.w, sizes: [], sum: 0, kids: 0, touched: false });
    switch (this.state) {
      case 'start':
        if (t !== id.H && t !== id.V) { this.ok = false; return; }
        this.stack.push(cutOf(t === id.H ? 'H' : 'V', { x: 0, y: 0, w: this.w, d: this.d }));
        this.state = 'sizes'; return;
      case 'sizes': {
        if (t === id['[']) { this.state = 'open'; return; }
        if (!(val[t] > 0)) { this.ok = false; return; }
        const span = this.upSpan(f);
        f.sizes.push(val[t]); f.sum += val[t];
        if (span && (Math.abs(f.sum - span[0]) < EPS || Math.abs(f.sum - span[1]) < EPS)) f.touched = true;
        return;
      }
      case 'parts':
        if (t === id['[']) { this.state = 'open'; return; }
        if (t === id[']'] && this.stack.length > 1) { this.stack.pop(); closePart(); return; }
        this.state = 'done'; return;
      case 'open': {
        const r = this.partRect();
        if (t === id.H || t === id.V) { this.stack.push(cutOf(t === id.H ? 'H' : 'V', r)); this.state = 'sizes'; return; }
        if (t === id.bed || t === id.master) this.beds += 1;
        if (t === id.stairs) this.stairs += 1;
        if (t === id.kitchen) this.kitchen += 1;
        if (t === id.drawing) this.drawing += 1;
        if (t === id.lounge) this.lounge += 1;
        if (t === id.bath) this.baths += 1;
        this.leaf = { t: name[t], w: r.w, d: r.d, stage: 0, bw: 0 }; this.state = 'leaf'; return;
      }
      case 'leaf':
        if (t === id[']']) { this.leaf = null; closePart(); return; }
        if (t === id['+']) this.baths += 1;
        this.leaf.stage += 1; return;
      default:
    }
  }

  /** How many more tokens the plan needs at the very least (so the writer can be steered to finish before it runs out of room). */
  minLeft() {
    let n = this.state === 'leaf' ? 1 : this.state === 'open' ? 2 : 0;
    for (const f of this.stack) n += Math.max(0, f.sizes.length + 1 - f.kids - (f === this.stack[this.stack.length - 1] && (this.state === 'leaf' || this.state === 'open') ? 1 : 0)) * 3 + 1;
    return n + this.needed() * 2;
  }
}
