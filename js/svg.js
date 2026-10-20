// plan colours: the landing page's plan palette (Earth ink on off-white paper), the same in light and dark mode
const FILL = {
  drawing: '#e6decf', lobby: '#f6f2e9', lounge: '#ebe5d9', dining: '#dce4e0',
  kitchen: '#cfdad5', bed: '#e3e8e1', bath: '#bfcbc7', gbath: '#bfcbc7', stairs: '#ddd8cd',
  passage: '#f3efe6', store: '#e2ddd2', dress: '#dfe4dd', servant: '#e4ded3', study: '#e6e3d6', prayer: '#ece6d8', other: '#e8e4da',
};
const PAPER = '#fbf8f1', YARD = '#efeae2', INK = '#3a2f2c', WINDOW = '#6f8f96';

/** Drawing scale of a plan: feet -> SVG units (x across, z from the road, which is at the bottom of the plan as drawn).
 *  The plan is shown turned on its side (`landscape`, the road on the left) so a long plot lies across the screen; the box
 *  maxW x maxH is then read the other way round, so a plan keeps the size it had standing up. X and Y are the plan's own
 *  (upright) coordinates; vw x vh is the size the SVG ends up with. */
export function planFrame(L, { maxW = 320, maxH = 470, landscape = true } = {}) {
  const { w: W, d: D } = L.plot;
  const m = 24, road = 20, turn = landscape && D > W * 1.05;
  const [bw, bh] = turn ? [maxH, maxW] : [maxW, maxH];
  const s = Math.min((bw - 2 * m) / W, (bh - 2 * m - road) / D);
  const iw = 2 * m + W * s, ih = 2 * m + D * s + road;
  return { s, m, turn, iw, ih, vw: turn ? ih : iw, vh: turn ? iw : ih, X: (x) => m + x * s, Y: (z) => m + (D - z) * s };
}

/** overlay(frame) -> extra SVG markup drawn on top (the editor's drag handles). */
export function planSVG(L, { maxW = 320, maxH = 470, labels = true, overlay = null, furniture = false, landscape = true } = {}) {
  const { w: W, d: D } = L.plot;
  const frame = planFrame(L, { maxW, maxH, landscape });
  const { s, X, Y, iw: vw, ih: vh } = frame;           // the upright drawing's own size
  const B = L.B;
  const off = (x, y, dx, dy) => (frame.turn ? [x + dy, y - dx] : [x + dx, y + dy]);   // a point dx to the right and dy down of (x, y) as the viewer sees the plan
  let o = '', txt = '';                                           // txt: the labels, which are turned back upright when the plan lies on its side
  o += `<rect x="${X(0)}" y="${Y(D)}" width="${W * s}" height="${D * s}" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>`;
  const open = L.open || [];
  const innerPorch = open.some((p) => p.type === 'porch');      // any car porch: the front strip is then just lawn
  if (!L.upper) {
    o += `<rect x="${X(0)}" y="${Y(B.z)}" width="${W * s}" height="${B.z * s}" fill="${YARD}"/>`;
    { const [lx, ly] = off(X(W / 2), Y(B.z / 2), 0, 3); txt += `<text x="${lx}" y="${ly}" font-size="9" fill="#8a8678" text-anchor="middle">${innerPorch ? 'lawn' : 'porch / lawn'}</text>`; }
  }
  o += `<rect x="${X(B.x)}" y="${Y(B.z + B.d)}" width="${B.w * s}" height="${B.d * s}" fill="none" stroke="#999" stroke-dasharray="3 3" stroke-width=".8"/>`;
  // car porch and light wells inside the house outline: open to the sky or roofed, but not rooms
  for (const p of open) {
    o += `<rect x="${X(p.x)}" y="${Y(p.z + p.d)}" width="${p.w * s}" height="${p.d * s}" fill="${p.type === 'porch' ? YARD : p.type === 'terrace' ? '#d8ecc8' : p.type === 'balcony' ? '#e6dfc9' : '#dbe5d8'}" stroke="#8a7f78" stroke-dasharray="4 3" stroke-width=".9"/>`;
  }
  const order = [...L.rooms.filter((r) => !r.parent), ...L.rooms.filter((r) => r.parent)];
  for (const r of order) {
    o += `<rect x="${X(r.x)}" y="${Y(r.z + r.d)}" width="${r.w * s}" height="${r.d * s}" fill="${FILL[r.type]}" stroke="${INK}" stroke-width="${r.parent ? 1.1 : 1.8}"/>`;
  }
  if (furniture && L.furniture) o += furnitureSVG(L.furniture, frame);
  for (const op of L.openings) {
    const half = (op.w / 2) * s;
    if (op.kind === 'window') {
      const col = WINDOW;
      o += op.o === 'h'
        ? `<line x1="${X(op.at) - half}" x2="${X(op.at) + half}" y1="${Y(op.c)}" y2="${Y(op.c)}" stroke="${col}" stroke-width="4"/>`
        : `<line y1="${Y(op.at) - half}" y2="${Y(op.at) + half}" x1="${X(op.c)}" x2="${X(op.c)}" stroke="${col}" stroke-width="4"/>`;
    } else {
      const wpx = op.w * s;
      if (op.o === 'h') {
        const x0 = X(op.at) - half, y0 = Y(op.c);
        o += `<line x1="${x0}" x2="${x0 + wpx}" y1="${y0}" y2="${y0}" stroke="${PAPER}" stroke-width="4"/>`;
        if (op.kind === 'door') o += `<path d="M${x0} ${y0} L${x0} ${y0 - wpx} A${wpx} ${wpx} 0 0 1 ${x0 + wpx} ${y0}" fill="none" stroke="#555" stroke-width=".9"/>`;
      } else {
        const x0 = X(op.c), y0 = Y(op.at - op.w / 2);
        o += `<line x1="${x0}" x2="${x0}" y1="${y0}" y2="${y0 - wpx}" stroke="${PAPER}" stroke-width="4"/>`;
        if (op.kind === 'door') o += `<path d="M${x0} ${y0} L${x0 + wpx} ${y0} A${wpx} ${wpx} 0 0 0 ${x0} ${y0 - wpx}" fill="none" stroke="#555" stroke-width=".9"/>`;
      }
    }
  }
  if (labels) {
    const fmtFt = (v) => { const h = Math.round(v * 2) / 2; return Number.isInteger(h) ? h : h.toFixed(1); };   // full room size to the half foot; an attached bath sits inside its room
    const halo = `paint-order="stroke" stroke="${PAPER}" stroke-width="2.4" stroke-linejoin="round"`;
    const fit = (txt, fs, maxPx) => Math.max(5.2, Math.min(fs, maxPx / (txt.length * 0.56)));   // shrink text that would not fit its room
    for (const r of L.rooms) {
      const cx = X(r.x + r.w / 2), cy = Y(r.z + r.d / 2);
      const across = frame.turn ? r.d : r.w;                       // the room's width as the viewer sees it
      const small = r.parent || across * s < 62;
      const fs = r.parent ? 7 : small ? 8 : 9.5;
      const nm = r.parent ? (r.name === 'Guest Bath' ? 'Guest bath' : r.name === 'Common Bath' ? 'Common bath' : 'Bath')
        : r.name.replace('Bedroom', 'Bed').replace('Master Bed', 'Master Bed').replace('Drawing Room', 'Drawing').replace('Lounge & Dining', 'Lounge/Dining');
      let tx = cx, ty = cy;
      const nameDy = r.parent ? -3 : 0;
      if (r.parent) { tx = X(r.x + r.w / 2); ty = Y(r.z + r.d / 2); }
      else if (r.att) { ty = Y(r.z + r.d / 2) + (r.att.z > r.z + r.d / 2 ? 0 : 0); tx = X(r.x + (r.att.x > r.x ? (r.w - r.att.w) / 2 : r.att.w + (r.w - r.att.w) / 2)); }
      const maxPx = across * s - 4;
      const size = `${fmtFt(r.w)}' x ${fmtFt(r.d)}'`;
      const [nx, ny] = off(tx, ty, 0, nameDy), [zx, zy] = off(tx, ty, 0, nameDy + (r.parent ? 8 : 10));
      txt += `<text x="${nx}" y="${ny}" font-size="${fit(nm, fs, maxPx)}" text-anchor="middle" fill="#222" font-weight="${r.parent ? 500 : 600}" ${halo}>${nm}</text>`;
      // every room shows its size, washrooms and the kitchen included
      txt += `<text x="${zx}" y="${zy}" font-size="${fit(size, r.parent ? 6.4 : 7.5, maxPx)}" text-anchor="middle" fill="#444" ${halo}>${size}</text>`;
    }
    for (const p of open) {
      const cx = X(p.x + p.w / 2), cy = Y(p.z + p.d / 2), maxPx = (frame.turn ? p.d : p.w) * s - 4, [sx, sy] = off(cx, cy, 0, 10);
      const nm = p.type === 'porch' ? (p.w >= 9.5 ? `Car porch (${p.w >= 25.5 ? 3 : p.w >= 17.5 ? 2 : 1} car${p.w >= 17.5 ? 's' : ''})` : 'Small porch') : p.type === 'terrace' ? 'Terrace' : p.type === 'balcony' ? 'Balcony' : 'Light well', size = `${fmtFt(p.w)}' x ${fmtFt(p.d)}'`;
      txt += `<text x="${cx}" y="${cy}" font-size="${fit(nm, 8.5, maxPx)}" text-anchor="middle" fill="#6f6b5e" font-weight="600" ${halo}>${nm}</text>`;
      txt += `<text x="${sx}" y="${sy}" font-size="${fit(size, 7.2, maxPx)}" text-anchor="middle" fill="#6f6b5e" ${halo}>${size}</text>`;
    }
  }
  txt += `<text x="${X(W / 2)}" y="${Y(0) + 13}" font-size="9" text-anchor="middle" fill="#666">${W} ft</text>`;
  txt += `<text x="${X(0) - 10}" y="${Y(D / 2)}" font-size="9" text-anchor="middle" fill="#666" transform="rotate(-90 ${X(0) - 10} ${Y(D / 2)})">${D} ft</text>`;
  o += `<rect x="${X(-3)}" y="${vh - 9}" width="${W * s + 6 * s}" height="6" fill="#8d8d8d"/>`;
  if (!frame.turn) txt += `<text x="${X(W / 2)}" y="${vh - 3.6}" font-size="5.5" fill="#fff" text-anchor="middle" letter-spacing="2">ROAD</text>`;
  if (frame.turn) txt = txt.replace(/<text x="([-\d.]+)" y="([-\d.]+)"(?![^>]*transform=)/g, '<text x="$1" y="$2" transform="rotate(-90 $1 $2)"');
  o += txt;
  if (overlay) o += overlay(frame);
  // lying on its side: turned a quarter, the road on the left (a point (x, y) of the upright drawing lands at (ih - y, x))
  const body = frame.turn ? `<g transform="translate(${frame.ih} 0) rotate(90)">${o}</g>` : o;
  return `<svg viewBox="0 0 ${frame.vw} ${frame.vh}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Floor plan ${L.label}"${frame.turn ? ' data-turn="1"' : ''}>${body}</svg>`;
}

/** Front elevation. U: the first-floor layout of a two-storey house (its storey is drawn above the ground floor). */
export function elevationSVG(L, st, U = null) {
  const { w: W } = L.plot;
  const B = L.B;
  const s = 10, pad = 3;
  const vw = (W + 2 * pad) * s, gh = 2 * s, top = 3 * s;
  const H = 10, SLAB = 0.6, TOP = U ? H + SLAB + H : H;            // height of the highest wall
  const vh = top + (TOP + 3) * s + gh;
  const gy = top + (TOP + 3) * s;
  const X = (x) => (x + pad) * s;
  const Y = (h) => gy - h * s;
  let o = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Front elevation, ${st.name}">`;
  o += `<defs><linearGradient id="sky${st.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe0f5"/><stop offset="1" stop-color="#eef7fc"/></linearGradient></defs>`;
  o += `<rect width="${vw}" height="${vh}" fill="url(#sky${st.id})"/>`;
  o += `<rect x="0" y="${gy}" width="${vw}" height="${gh}" fill="#9aa08f"/><rect x="0" y="${gy}" width="${vw}" height="3" fill="#7f8a73"/>`;
  const bx = X(B.x), bw = B.w * s;
  o += `<rect x="${bx}" y="${Y(H)}" width="${bw}" height="${H * s}" fill="${st.wall}" stroke="#00000022"/>`;
  // the top storey: parapet / roof edge, and for a two-storey house the first-floor walls, slab and low terrace parapet
  const T = U ? U.B : B, topH = U ? H + SLAB + H : H;
  const tx = X(T.x), tw = T.w * s;
  const paraFill = st.id === 'spanish' ? st.roof : st.id === 'modern' ? st.trim : st.wall;
  if (U) {
    o += `<rect x="${bx - 4}" y="${Y(H + SLAB + 3)}" width="${bw + 8}" height="${3 * s}" fill="${paraFill}" stroke="#00000022"/>`;     // parapet round the open terrace
    o += `<rect x="${bx - 6}" y="${Y(H + SLAB)}" width="${bw + 12}" height="${SLAB * s}" fill="${st.trim}" stroke="#00000033"/>`;          // slab edge
    o += `<rect x="${tx}" y="${Y(topH)}" width="${tw}" height="${H * s}" fill="${st.wall}" stroke="#00000022"/>`;
  }
  o += `<rect x="${tx - 4}" y="${Y(topH + 2.6)}" width="${tw + 8}" height="${2.6 * s}" fill="${paraFill}" stroke="#00000022"/>`;
  if (st.id === 'classic') o += `<rect x="${tx - 7}" y="${Y(topH + 3.1)}" width="${tw + 14}" height="6" fill="${st.trim}" stroke="#00000033"/><rect x="${tx - 6}" y="${Y(topH)}" width="${tw + 12}" height="7" fill="${st.trim}" stroke="#00000033"/>`;
  if (st.id === 'spanish') for (let i = 0; i < tw; i += 8) o += `<rect x="${tx - 4 + i}" y="${Y(topH + 2.6)}" width="4" height="${2.6 * s}" fill="#00000018"/>`;
  const windows = (layout, lift) => {
    for (const p of layout.openings.filter((q) => q.o === 'h' && Math.abs(q.c - layout.B.z) < 0.01)) {
      const x0 = X(p.at - p.w / 2), w = p.w * s;
      if (p.kind === 'window') {
        o += `<rect x="${x0}" y="${Y(p.top + lift)}" width="${w}" height="${(p.top - p.sill) * s}" fill="${st.glass}" stroke="${st.frame}" stroke-width="2.5"/>`;
        o += `<line x1="${x0 + w / 2}" x2="${x0 + w / 2}" y1="${Y(p.top + lift)}" y2="${Y(p.sill + lift)}" stroke="${st.frame}" stroke-width="1.5"/>`;
        if (st.id !== 'modern') o += `<rect x="${x0 - 3}" y="${Y(p.sill + lift)}" width="${w + 6}" height="4" fill="${st.trim}" stroke="#00000033"/>`;
      }
    }
  };
  windows(L, 0);
  if (U) windows(U, H + SLAB);
  const door = L.openings.find((p) => p.main);                  // may be set back behind the car porch
  const dx = X(door.at - door.w / 2), dw = door.w * s;
  if (st.id === 'modern') o += `<rect x="${dx - 12}" y="${Y(H)}" width="${dw + 24}" height="${H * s}" fill="${st.accent}" opacity=".92"/>`;
  if (st.id === 'spanish') o += `<path d="M${dx} ${Y(0)} V${Y(6)} A${dw / 2} ${dw / 2} 0 0 1 ${dx + dw} ${Y(6)} V${Y(0)} Z" fill="${st.frame}"/>`;
  else o += `<rect x="${dx}" y="${Y(7.2)}" width="${dw}" height="${7.2 * s}" fill="${st.id === 'classic' ? '#7a5a36' : '#5b4030'}" stroke="${st.frame}" stroke-width="2"/>`;
  // porch canopy and pillars
  o += `<rect x="${bx - 6}" y="${Y(9.8)}" width="${bw + 12}" height="${0.6 * s}" fill="${st.id === 'spanish' ? st.roof : st.trim}" stroke="#00000033"/>`;
  const n = Math.max(2, Math.round(B.w / 12) + 1);
  for (let i = 0; i < n; i++) {
    const px = bx + 6 + (i * (bw - 12)) / (n - 1);
    if (st.pillar === 'column') o += `<rect x="${px - 5}" y="${Y(9.2)}" width="10" height="${9.2 * s}" fill="${st.trim}" stroke="#00000033"/><rect x="${px - 8}" y="${Y(9.2)}" width="16" height="5" fill="${st.trim}" stroke="#00000033"/><rect x="${px - 8}" y="${Y(0.6)}" width="16" height="6" fill="${st.trim}" stroke="#00000033"/>`;
    else if (st.pillar === 'arch') o += `<rect x="${px - 4}" y="${Y(9.2)}" width="8" height="${9.2 * s}" fill="${st.wall}" stroke="#00000033"/>`;
    else o += `<rect x="${px - 3}" y="${Y(9.2)}" width="6" height="${9.2 * s}" fill="${st.trim}"/>`;
  }
  // compound wall with gate gap
  const gx = X(door.at - 4), gw = 8 * s;
  o += `<rect x="${X(0)}" y="${Y(3.6)}" width="${W * s}" height="${3.6 * s}" fill="${st.wall}" stroke="#00000033"/><rect x="${gx}" y="${Y(3.6)}" width="${gw}" height="${3.6 * s}" fill="#9aa08f"/>`;
  o += `<rect x="${gx - 4}" y="${Y(4.5)}" width="6" height="${4.5 * s}" fill="${st.trim}"/><rect x="${gx + gw - 2}" y="${Y(4.5)}" width="6" height="${4.5 * s}" fill="${st.trim}"/>`;
  return o + '</svg>';
}

// ---------------------------------------------------------------- furniture in plan, drawn the way architects draw it
const F_INK = '#5b514c', F_FILL = '#fffdf8';
/** Plan symbols for furniture.js pieces. Each piece is drawn in its own frame (front toward +z), then turned and placed. */
export function furnitureSVG(items, { s, X, Y }) {
  let o = '<g class="furn">';
  const under = (i) => (i.k === 'rug' || i.k === 'mat' ? 0 : 1);       // rugs first, so the pieces standing on them stay on top
  for (const it of [...items].sort((a, b) => under(a) - under(b))) {
    if (it.k === 'fan' || it.k === 'lampTable' || it.k === 'kupper' || it.k === 'hood' || it.k === 'laptop') continue;
    const w = it.w * s, d = it.d * s;
    // the piece's own frame: x across its front (-w/2..w/2), y from its back (-d/2) to its front (d/2), front toward screen-down when facing the road
    const ang = Math.atan2(it.fx, it.fz) * 180 / Math.PI;             // screen y runs toward the road: local front (0,-1) -> (fx, -fz)
    const cx = X(it.x), cy = Y(it.z);
    let g = '';
    const r = (x, y, ww, hh, extra = '') => `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" ${extra}/>`;
    const st = `fill="${F_FILL}" stroke="${F_INK}" stroke-width=".6"`;
    // in the local frame used below, the back of the piece is at y = +d/2 and its front at -d/2 (the frame is turned so -y points the way it faces)
    const B = d / 2, Fr = -d / 2;
    switch (it.k) {
      case 'bedKing': case 'bedQueen': case 'bedSingle': {
        g += r(-w / 2, Fr, w, d, st);
        const pw = it.k === 'bedSingle' ? w - 4 : w / 2 - 3;
        if (it.k === 'bedSingle') g += r(-pw / 2, B - 2 - 0.9 * s, pw, 0.9 * s, `${st} rx="1.5"`);
        else { g += r(-w / 2 + 2, B - 2 - 0.9 * s, pw, 0.9 * s, `${st} rx="1.5"`); g += r(1, B - 2 - 0.9 * s, pw, 0.9 * s, `${st} rx="1.5"`); }
        g += `<path d="M${-w / 2} ${B - 1.6 * s} L${w / 2} ${B - 1.6 * s}" stroke="${F_INK}" stroke-width=".5"/>`;
        g += `<path d="M${-w / 2} ${Fr + d * 0.38} L${w / 2} ${Fr + d * 0.3}" stroke="${F_INK}" stroke-width=".45" fill="none"/>`;
        break;
      }
      case 'sofa3': case 'sofa2': case 'armchair': {
        g += r(-w / 2, Fr, w, d, `${st} rx="2"`);
        g += r(-w / 2, B - 0.7 * s, w, 0.7 * s, `fill="#efe9de" stroke="${F_INK}" stroke-width=".5"`);
        g += r(-w / 2, Fr, 0.6 * s, d, `fill="#efe9de" stroke="${F_INK}" stroke-width=".5"`) + r(w / 2 - 0.6 * s, Fr, 0.6 * s, d, `fill="#efe9de" stroke="${F_INK}" stroke-width=".5"`);
        const n = it.k === 'sofa3' ? 3 : it.k === 'sofa2' ? 2 : 1, cw = (w - 1.2 * s) / n;
        for (let i = 1; i < n; i++) g += `<line x1="${-w / 2 + 0.6 * s + i * cw}" x2="${-w / 2 + 0.6 * s + i * cw}" y1="${Fr}" y2="${B - 0.7 * s}" stroke="${F_INK}" stroke-width=".4"/>`;
        break;
      }
      case 'tableRound': g += `<circle cx="0" cy="0" r="${w / 2}" ${st}/>`; break;
      case 'chair': case 'deskChair': g += r(-w / 2 + 1, Fr + 1, w - 2, d - 2, `${st} rx="1.5"`) + r(-w / 2 + 1, B - 0.35 * s - 1, w - 2, 0.35 * s, `fill="${F_INK}"`); break;
      case 'stove': g += r(-w / 2, Fr, w, d, st); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g += `<circle cx="${a * w / 4}" cy="${b * d / 4}" r="${Math.min(w, d) / 7}" fill="none" stroke="${F_INK}" stroke-width=".5"/>`; break;
      case 'sink': g += r(-w / 2, Fr, w, d, st) + r(-w / 2 + 0.4 * s, Fr + 0.4 * s, w - 0.8 * s, d - 0.9 * s, `fill="#e3ecef" stroke="${F_INK}" stroke-width=".5" rx="2"`); break;
      case 'fridge': g += r(-w / 2, Fr, w, d, st) + `<text x="0" y="2" font-size="${Math.min(w, d) * 0.32}" text-anchor="middle" fill="${F_INK}">F</text>`; break;
      case 'kcounter': case 'sideboard': case 'tvUnit': case 'bedside': case 'sideTable': case 'coffeeTable': case 'desk':
      case 'tableDining6': case 'tableDining4': case 'bookcase': g += r(-w / 2, Fr, w, d, st); break;
      case 'wardrobe': case 'wardrobeSmall': g += r(-w / 2, Fr, w, d, st) + `<path d="M${-w / 2} ${Fr} L${w / 2} ${B} M${w / 2} ${Fr} L${-w / 2} ${B}" stroke="${F_INK}" stroke-width=".35"/>`; break;
      case 'toilet': g += r(-w / 2, B - 0.55 * s, w, 0.55 * s, st) + `<ellipse cx="0" cy="${(Fr + B - 0.55 * s) / 2}" rx="${w / 2 - 0.5}" ry="${(d - 0.55 * s) / 2}" ${st}/>`; break;
      case 'basin': g += `<path d="M${-w / 2} ${B} L${w / 2} ${B} L${w / 2} ${Fr + d * 0.4} Q0 ${Fr - d * 0.15} ${-w / 2} ${Fr + d * 0.4} Z" ${st}/>`; break;
      case 'shower': g += r(-w / 2, Fr, w, d, `fill="#eef4f5" stroke="${F_INK}" stroke-width=".6"`) + `<path d="M${-w / 2} ${Fr} L${w / 2} ${B} M${w / 2} ${Fr} L${-w / 2} ${B}" stroke="${F_INK}" stroke-width=".35"/><circle cx="0" cy="0" r="1.2" fill="${F_INK}"/>`; break;
      case 'bathtub': g += r(-w / 2, Fr, w, d, `${st} rx="2"`) + r(-w / 2 + 1.2, Fr + 1.2, w - 2.4, d - 2.4, `fill="#eef4f5" stroke="${F_INK}" stroke-width=".4" rx="${w / 3}"`); break;
      case 'plant': case 'pot': g += `<circle cx="0" cy="0" r="${w / 2}" fill="#dfe9d6" stroke="#6b8a5a" stroke-width=".6"/><circle cx="0" cy="0" r="${w / 5}" fill="#6b8a5a"/>`; break;
      case 'floorLamp': g += `<circle cx="0" cy="0" r="${w / 2}" fill="#fff6dc" stroke="${F_INK}" stroke-width=".5"/>`; break;
      case 'rug': case 'mat': g += r(-w / 2, Fr, w, d, `fill="#efe2cf" fill-opacity=".55" stroke="#b9a68c" stroke-width=".5" stroke-dasharray="2 1.5"`); break;
      case 'tv': g += r(-w / 2, -0.15 * s, w, 0.3 * s, `fill="${F_INK}"`); break;
      case 'coat': g += r(-w / 2, Fr, w, d, `fill="${F_INK}"`); break;
      default: g += r(-w / 2, Fr, w, d, st);
    }
    const cls = it.clash ? ' clash' : '';
    o += `<g class="fp${cls}" data-key="${it.key || ''}" transform="translate(${cx} ${cy}) rotate(${ang})">${g}${it.clash ? `<rect x="${-w / 2 - 1}" y="${-d / 2 - 1}" width="${w + 2}" height="${d + 2}" fill="none" stroke="#c0392b" stroke-width="1.2" stroke-dasharray="3 2"/>` : ''}</g>`;
  }
  return o + '</g>';
}
