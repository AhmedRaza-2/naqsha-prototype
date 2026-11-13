// Interior looks for the walkthrough: the same house shown in three styles with one click. A look is only colours and
// materials (wood, fabric, stone, the walls and floors, rugs, curtains, the art on the walls); the furniture stays
// where the plan put it.

export const LOOKS = {
  modern: {
    id: 'modern', name: 'Modern',
    wall: '#f1f0ec', floorLiving: 'marble', floorBed: 'wood',
    wood: '#8a6a4e', woodDark: '#35302c', metal: '#2a2d30', counter: '#ecebe7', linen: '#f4f2ee',
    fabric: { bed: '#cfd3d6', sofa: '#59646b', chair: '#8b8f92', armchair: '#b9b3a8', deskChair: '#2e3134', default: '#9a9690' },
    curtain: '#e4e3df', rod: '#2a2d30', throw: '#48545c', cushion: ['#2f3539', '#c9a45c', '#e7e4dd'],
    rug: { kind: 'border', base: '#dcd9d2', a: '#2f3539', b: '#a9a7a1' },
    art: { kind: 'blocks', paper: '#f2f0ea', frame: '#1f2224', inks: ['#2f3539', '#c9a45c', '#8d9aa3', '#d9d4c8'] },
    lampShade: '#f3ede0', plantPot: '#3a3d40',
  },
  scandi: {
    id: 'scandi', name: 'Scandinavian',
    wall: '#f7f5f0', floorLiving: 'oak', floorBed: 'oak',
    wood: '#d2b48a', woodDark: '#b2946c', metal: '#b9b3a8', counter: '#f6f5f2', linen: '#fbfaf6',
    fabric: { bed: '#e6e2d9', sofa: '#b9bdb8', chair: '#d8cdbb', armchair: '#9fae9f', deskChair: '#8d9490', default: '#cfc8ba' },
    curtain: '#faf8f3', rod: '#cdb48f', throw: '#a9b9a8', cushion: ['#9fae9f', '#e3c8b4', '#f1ece2'],
    rug: { kind: 'stripes', base: '#efe9dd', a: '#c9c2b2', b: '#9fae9f' },
    art: { kind: 'arches', paper: '#f6f2e9', frame: '#d2b48a', inks: ['#9fae9f', '#e3c8b4', '#c9b08a', '#6f7f75'] },
    lampShade: '#fbf6ea', plantPot: '#e9e3d6',
  },
  luxury: {
    id: 'luxury', name: 'Warm luxury',
    wall: '#efe5d5', floorLiving: 'marble-warm', floorBed: 'wood-dark',
    wood: '#5b3d2a', woodDark: '#2e1f16', metal: '#b08d4f', counter: '#3b3835', linen: '#f3ead9',
    fabric: { bed: '#d9c8ab', sofa: '#3f5a4f', chair: '#7a5a3c', armchair: '#8a3a34', deskChair: '#3a2a20', default: '#a88f6c' },
    curtain: '#c7ad84', rod: '#b08d4f', throw: '#7a2f2c', cushion: ['#7a2f2c', '#c9a45c', '#f0e4cc'],
    rug: { kind: 'medallion', base: '#6f2a28', a: '#c9a45c', b: '#f0e4cc' },
    art: { kind: 'landscape', paper: '#efe3cc', frame: '#b08d4f', inks: ['#3f5a4f', '#c9a45c', '#7a2f2c', '#d9c8ab'] },
    lampShade: '#f6e3bd', plantPot: '#2e1f16',
  },
};
export const LOOK_IDS = Object.keys(LOOKS);

/** The look that suits a facade style until the visitor picks one. */
export const lookFor = (styleFamily) => (styleFamily === 'classic' ? 'luxury' : styleFamily === 'spanish' ? 'scandi' : 'modern');

// ---------------------------------------------------------------- drawn textures: rugs and wall art
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

/** A rug as a canvas (w x d in feet set its proportions): a bordered plain rug, woven stripes or a medallion carpet. */
export function rugCanvas(look, w, d) {
  const N = 384, c = document.createElement('canvas');
  c.width = N; c.height = Math.max(96, Math.round(N * d / w));
  const g = c.getContext('2d'), W = c.width, H = c.height, r = look.rug, rnd = rng(Math.round(w * 31 + d * 17));
  g.fillStyle = r.base; g.fillRect(0, 0, W, H);
  if (r.kind === 'border') {
    g.strokeStyle = r.a; g.lineWidth = W * 0.022; g.strokeRect(W * 0.05, W * 0.05, W - W * 0.1, H - W * 0.1);
    g.strokeStyle = r.b; g.lineWidth = W * 0.008; g.strokeRect(W * 0.085, W * 0.085, W - W * 0.17, H - W * 0.17);
  } else if (r.kind === 'stripes') {
    const n = 9;
    for (let i = 0; i < n; i++) { g.fillStyle = i % 3 === 1 ? r.b : r.a; if (i % 3 !== 0) g.fillRect(0, (H * (i + 0.2)) / n, W, (H * 0.34) / n); }
    g.fillStyle = r.a; for (let x = 0; x < W; x += W / 40) { g.fillRect(x, 0, W / 80, H * 0.03); g.fillRect(x, H * 0.97, W / 80, H * 0.03); }      // the fringe
  } else {
    const m = W * 0.06;
    g.strokeStyle = r.a; g.lineWidth = W * 0.018; g.strokeRect(m, m, W - 2 * m, H - 2 * m);
    g.strokeStyle = r.b; g.lineWidth = W * 0.006; g.strokeRect(m * 1.7, m * 1.7, W - 3.4 * m, H - 3.4 * m);
    g.fillStyle = r.a;
    for (let x = m * 2.4; x < W - m * 2.4; x += W * 0.055) for (const y of [m * 1.15, H - m * 1.15]) { g.beginPath(); g.arc(x, y, W * 0.008, 0, 7); g.fill(); }
    // the medallion: a lozenge with a smaller one inside, and four corner pieces
    const cx = W / 2, cy = H / 2, rx = W * 0.2, ry = H * 0.3;
    const loz = (kx, ky, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(cx, cy - ky); g.lineTo(cx + kx, cy); g.lineTo(cx, cy + ky); g.lineTo(cx - kx, cy); g.closePath(); g.fill(); };
    loz(rx, ry, r.a); loz(rx * 0.74, ry * 0.74, r.base); loz(rx * 0.42, ry * 0.42, r.b);
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { g.fillStyle = rgba(r.a, 0.85); g.beginPath(); g.moveTo(cx + sx * (W / 2 - m * 2.2), cy + sy * (H / 2 - m * 2.2)); g.lineTo(cx + sx * (W / 2 - m * 2.2 - W * 0.13), cy + sy * (H / 2 - m * 2.2)); g.lineTo(cx + sx * (W / 2 - m * 2.2), cy + sy * (H / 2 - m * 2.2 - W * 0.13)); g.closePath(); g.fill(); }
  }
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${rnd() * 0.05})`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }      // the weave
  return c;
}

/** A framed picture as a canvas, drawn in the look's colours; `seed` makes each picture in a house a different one. */
export function artCanvas(look, w, h, seed = 1) {
  const N = 256, c = document.createElement('canvas');
  c.width = N; c.height = Math.max(64, Math.round(N * h / w));
  const g = c.getContext('2d'), W = c.width, H = c.height, a = look.art, rnd = rng(seed * 7919 + 13), ink = (i) => a.inks[i % a.inks.length];
  g.fillStyle = a.paper; g.fillRect(0, 0, W, H);
  if (a.kind === 'blocks') {                                        // abstract: a few overlapping blocks and one thin line
    for (let i = 0; i < 4; i++) { g.fillStyle = rgba(ink(i + seed), 0.92); const bw = W * (0.22 + rnd() * 0.3), bh = H * (0.2 + rnd() * 0.35); g.fillRect(W * 0.1 + rnd() * (W * 0.8 - bw), H * 0.1 + rnd() * (H * 0.8 - bh), bw, bh); }
    g.strokeStyle = ink(seed); g.lineWidth = 2; g.beginPath(); g.moveTo(W * 0.08, H * (0.3 + rnd() * 0.4)); g.lineTo(W * 0.92, H * (0.3 + rnd() * 0.4)); g.stroke();
  } else if (a.kind === 'arches') {                                 // soft arches and a sun
    const n = 3;
    for (let i = 0; i < n; i++) { const r = W * (0.34 - i * 0.085), cx = W * (0.36 + rnd() * 0.1), cy = H * 0.86; g.fillStyle = ink(i + seed); g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.lineTo(cx + r, H); g.lineTo(cx - r, H); g.closePath(); g.fill(); }
    g.fillStyle = ink(seed + 1); g.beginPath(); g.arc(W * (0.72 + rnd() * 0.08), H * (0.26 + rnd() * 0.1), W * 0.09, 0, 7); g.fill();
  } else {                                                          // a landscape in layers: sky, far hills, near hills
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, rgba(ink(3), 1)); gr.addColorStop(1, a.paper); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = rgba(ink(1), 0.9); g.beginPath(); g.arc(W * (0.3 + rnd() * 0.4), H * 0.34, W * 0.07, 0, 7); g.fill();
    for (let k = 0; k < 3; k++) {
      g.fillStyle = rgba(ink(k === 1 ? 2 : 0), 0.55 + k * 0.2); g.beginPath(); g.moveTo(0, H);
      const y0 = H * (0.5 + k * 0.14), ph = rnd() * 6;
      for (let x = 0; x <= W; x += 8) g.lineTo(x, y0 + Math.sin(x / (30 + k * 14) + ph) * H * 0.06 + Math.sin(x / 11 + ph * 2) * H * 0.012);
      g.lineTo(W, H); g.closePath(); g.fill();
    }
  }
  return c;
}
