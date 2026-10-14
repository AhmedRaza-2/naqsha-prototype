const FILL = {
  drawing: '#f6e7c8', lobby: '#ececec', lounge: '#dfeedb', dining: '#dce8f4',
  kitchen: '#f7dccd', bed: '#e7e0f4', bath: '#c9e5ee', gbath: '#c9e5ee', stairs: '#e4e1d8',
};

export function planSVG(L, { maxW = 320, maxH = 470, labels = true } = {}) {
  const { w: W, d: D } = L.plot;
  const m = 24, road = 20;
  const s = Math.min((maxW - 2 * m) / W, (maxH - 2 * m - road) / D);
  const X = (x) => m + x * s;
  const Y = (z) => m + (D - z) * s;
  const vw = 2 * m + W * s, vh = 2 * m + D * s + road;
  const B = L.B;
  let o = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Floor plan ${L.label}">`;
  o += `<rect x="${X(0)}" y="${Y(D)}" width="${W * s}" height="${D * s}" fill="#f4f2ea" stroke="#555" stroke-width="1.5"/>`;
  const open = L.open || [];
  const innerPorch = open.some((p) => p.type === 'porch');
  o += `<rect x="${X(0)}" y="${Y(B.z)}" width="${W * s}" height="${B.z * s}" fill="#e3e0d6"/>`;
  o += `<text x="${X(W / 2)}" y="${Y(B.z / 2) + 3}" font-size="9" fill="#8a8678" text-anchor="middle">${innerPorch ? 'lawn' : 'porch / lawn'}</text>`;
  o += `<rect x="${X(B.x)}" y="${Y(B.z + B.d)}" width="${B.w * s}" height="${B.d * s}" fill="none" stroke="#999" stroke-dasharray="3 3" stroke-width=".8"/>`;
  // car porch and light wells inside the house outline: open to the sky or roofed, but not rooms
  for (const p of open) {
    o += `<rect x="${X(p.x)}" y="${Y(p.z + p.d)}" width="${p.w * s}" height="${p.d * s}" fill="${p.type === 'porch' ? '#e3e0d6' : '#e9efe2'}" stroke="#8a8678" stroke-dasharray="4 3" stroke-width=".9"/>`;
  }
  const order = [...L.rooms.filter((r) => !r.parent), ...L.rooms.filter((r) => r.parent)];
  for (const r of order) {
    o += `<rect x="${X(r.x)}" y="${Y(r.z + r.d)}" width="${r.w * s}" height="${r.d * s}" fill="${FILL[r.type]}" stroke="#2b2b2b" stroke-width="${r.parent ? 1.1 : 1.8}"/>`;
  }
  for (const op of L.openings) {
    const half = (op.w / 2) * s;
    if (op.kind === 'window') {
      const col = '#3f9ad0';
      o += op.o === 'h'
        ? `<line x1="${X(op.at) - half}" x2="${X(op.at) + half}" y1="${Y(op.c)}" y2="${Y(op.c)}" stroke="${col}" stroke-width="4"/>`
        : `<line y1="${Y(op.at) - half}" y2="${Y(op.at) + half}" x1="${X(op.c)}" x2="${X(op.c)}" stroke="${col}" stroke-width="4"/>`;
    } else {
      const wpx = op.w * s;
      if (op.o === 'h') {
        const x0 = X(op.at) - half, y0 = Y(op.c);
        o += `<line x1="${x0}" x2="${x0 + wpx}" y1="${y0}" y2="${y0}" stroke="#f4f2ea" stroke-width="4"/>`;
        if (op.kind === 'door') o += `<path d="M${x0} ${y0} L${x0} ${y0 - wpx} A${wpx} ${wpx} 0 0 1 ${x0 + wpx} ${y0}" fill="none" stroke="#555" stroke-width=".9"/>`;
      } else {
        const x0 = X(op.c), y0 = Y(op.at - op.w / 2);
        o += `<line x1="${x0}" x2="${x0}" y1="${y0}" y2="${y0 - wpx}" stroke="#f4f2ea" stroke-width="4"/>`;
        if (op.kind === 'door') o += `<path d="M${x0} ${y0} L${x0 + wpx} ${y0} A${wpx} ${wpx} 0 0 0 ${x0} ${y0 - wpx}" fill="none" stroke="#555" stroke-width=".9"/>`;
      }
    }
  }
  if (labels) {
    const fmtFt = (v) => { const h = Math.round(v * 2) / 2; return Number.isInteger(h) ? h : h.toFixed(1); };   // full room size to the half foot; an attached bath sits inside its room
    const halo = 'paint-order="stroke" stroke="#f4f2ea" stroke-width="2.4" stroke-linejoin="round"';
    const fit = (txt, fs, maxPx) => Math.max(5.2, Math.min(fs, maxPx / (txt.length * 0.56)));   // shrink text that would not fit its room
    for (const r of L.rooms) {
      const cx = X(r.x + r.w / 2), cy = Y(r.z + r.d / 2);
      const small = r.parent || r.w * s < 62;
      const fs = r.parent ? 7 : small ? 8 : 9.5;
      const nm = r.parent ? (r.name === 'Guest Bath' ? 'Guest bath' : r.name === 'Common Bath' ? 'Common bath' : 'Bath')
        : r.name.replace('Bedroom', 'Bed').replace('Master Bed', 'Master Bed').replace('Drawing Room', 'Drawing').replace('Lounge & Dining', 'Lounge/Dining');
      let tx = cx, ty = cy;
      if (r.parent) { tx = X(r.x + r.w / 2); ty = Y(r.z + r.d / 2) - 3; }
      else if (r.att) { ty = Y(r.z + r.d / 2) + (r.att.z > r.z + r.d / 2 ? 0 : 0); tx = X(r.x + (r.att.x > r.x ? (r.w - r.att.w) / 2 : r.att.w + (r.w - r.att.w) / 2)); }
      const maxPx = r.w * s - 4;
      const size = `${fmtFt(r.w)}' x ${fmtFt(r.d)}'`;
      o += `<text x="${tx}" y="${ty}" font-size="${fit(nm, fs, maxPx)}" text-anchor="middle" fill="#222" font-weight="${r.parent ? 500 : 600}" ${halo}>${nm}</text>`;
      // every room shows its size, washrooms and the kitchen included
      o += `<text x="${tx}" y="${ty + (r.parent ? 8 : 10)}" font-size="${fit(size, r.parent ? 6.4 : 7.5, maxPx)}" text-anchor="middle" fill="#444" ${halo}>${size}</text>`;
    }
    for (const p of open) {
      const cx = X(p.x + p.w / 2), cy = Y(p.z + p.d / 2), maxPx = p.w * s - 4;
      const nm = p.type === 'porch' ? 'Car porch' : 'Light well', size = `${fmtFt(p.w)}' x ${fmtFt(p.d)}'`;
      o += `<text x="${cx}" y="${cy}" font-size="${fit(nm, 8.5, maxPx)}" text-anchor="middle" fill="#6f6b5e" font-weight="600" ${halo}>${nm}</text>`;
      o += `<text x="${cx}" y="${cy + 10}" font-size="${fit(size, 7.2, maxPx)}" text-anchor="middle" fill="#6f6b5e" ${halo}>${size}</text>`;
    }
  }
  o += `<text x="${X(W / 2)}" y="${Y(0) + 13}" font-size="9" text-anchor="middle" fill="#666">${W} ft</text>`;
  o += `<text x="${X(0) - 10}" y="${Y(D / 2)}" font-size="9" text-anchor="middle" fill="#666" transform="rotate(-90 ${X(0) - 10} ${Y(D / 2)})">${D} ft</text>`;
  o += `<rect x="${X(-3)}" y="${vh - 9}" width="${W * s + 6 * s}" height="6" fill="#8d8d8d"/><text x="${X(W / 2)}" y="${vh - 3.6}" font-size="5.5" fill="#fff" text-anchor="middle" letter-spacing="2">ROAD</text>`;
  return o + '</svg>';
}

export function elevationSVG(L, st) {
  const { w: W } = L.plot;
  const B = L.B;
  const s = 10, pad = 3;
  const vw = (W + 2 * pad) * s, gh = 2 * s, top = 3 * s;
  const H = 10, vh = top + (H + 3) * s + gh;
  const gy = top + (H + 3) * s;
  const X = (x) => (x + pad) * s;
  const Y = (h) => gy - h * s;
  let o = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Front elevation, ${st.name}">`;
  o += `<defs><linearGradient id="sky${st.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe0f5"/><stop offset="1" stop-color="#eef7fc"/></linearGradient></defs>`;
  o += `<rect width="${vw}" height="${vh}" fill="url(#sky${st.id})"/>`;
  o += `<rect x="0" y="${gy}" width="${vw}" height="${gh}" fill="#9aa08f"/><rect x="0" y="${gy}" width="${vw}" height="3" fill="#7f8a73"/>`;
  const bx = X(B.x), bw = B.w * s;
  o += `<rect x="${bx}" y="${Y(H)}" width="${bw}" height="${H * s}" fill="${st.wall}" stroke="#00000022"/>`;
  // parapet / roof edge
  o += `<rect x="${bx - 4}" y="${Y(H + 2.6)}" width="${bw + 8}" height="${2.6 * s}" fill="${st.id === 'spanish' ? st.roof : st.id === 'modern' ? st.trim : st.wall}" stroke="#00000022"/>`;
  if (st.id === 'classic') o += `<rect x="${bx - 7}" y="${Y(H + 3.1)}" width="${bw + 14}" height="6" fill="${st.trim}" stroke="#00000033"/><rect x="${bx - 6}" y="${Y(H)}" width="${bw + 12}" height="7" fill="${st.trim}" stroke="#00000033"/>`;
  if (st.id === 'spanish') for (let i = 0; i < bw; i += 8) o += `<rect x="${bx - 4 + i}" y="${Y(H + 2.6)}" width="4" height="${2.6 * s}" fill="#00000018"/>`;
  const front = L.openings.filter((p) => p.o === 'h' && Math.abs(p.c - B.z) < 0.01);
  for (const p of front) {
    const x0 = X(p.at - p.w / 2), w = p.w * s;
    if (p.kind === 'window') {
      o += `<rect x="${x0}" y="${Y(p.top)}" width="${w}" height="${(p.top - p.sill) * s}" fill="${st.glass}" stroke="${st.frame}" stroke-width="2.5"/>`;
      o += `<line x1="${x0 + w / 2}" x2="${x0 + w / 2}" y1="${Y(p.top)}" y2="${Y(p.sill)}" stroke="${st.frame}" stroke-width="1.5"/>`;
      if (st.id !== 'modern') o += `<rect x="${x0 - 3}" y="${Y(p.sill) }" width="${w + 6}" height="4" fill="${st.trim}" stroke="#00000033"/>`;
    }
  }
  const door = front.find((p) => p.main);
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
