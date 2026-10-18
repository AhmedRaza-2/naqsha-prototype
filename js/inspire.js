// Design inspiration: a photo of a house (or any picture) gives the colours for the walls, trim and accent, and the style
// it is closest to. Everything happens in the browser: the picture is shrunk, its colours are grouped (k-means) and
// compared with the three styles. A photo of a floor plan cannot be read this way; the layout is asked for in words.

const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s, l };
}

/** Group the pixels of an RGBA array into k colours. -> [{ rgb, share, h, s, l }] sorted by share. */
export function dominantColors(data, w, hgt, k = 6) {
  const pts = [];
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (data[o + 3] < 200) continue;
    const r = data[o], g = data[o + 1], b = data[o + 2], c = hsl(r, g, b);
    // the sky (a blue or near-white band across the top) and the road are not part of the house
    if (y < hgt * 0.35 && ((c.h > 180 && c.h < 260 && c.s > 0.12) || (c.l > 0.93 && c.s < 0.1))) continue;
    if (y > hgt * 0.9 && c.s < 0.12 && c.l < 0.45) continue;
    pts.push([r, g, b]);
  }
  if (pts.length < 20) return [];
  // k-means, seeded on evenly spread points so the result is the same every time
  const cent = Array.from({ length: k }, (_, i) => pts[Math.floor(((i + 0.5) / k) * pts.length)].slice());
  const assign = new Uint8Array(pts.length);
  for (let it = 0; it < 12; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bd = 1e9;
      for (let c = 0; c < k; c++) { const d = (pts[i][0] - cent[c][0]) ** 2 + (pts[i][1] - cent[c][1]) ** 2 + (pts[i][2] - cent[c][2]) ** 2; if (d < bd) { bd = d; best = c; } }
      assign[i] = best; sum[best][0] += pts[i][0]; sum[best][1] += pts[i][1]; sum[best][2] += pts[i][2]; sum[best][3]++;
    }
    for (let c = 0; c < k; c++) if (sum[c][3]) cent[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  const count = new Array(k).fill(0);
  for (let i = 0; i < pts.length; i++) count[assign[i]]++;
  return cent.map((c, i) => ({ rgb: c, share: count[i] / pts.length, ...hsl(c[0], c[1], c[2]) })).filter((c) => c.share > 0.02).sort((a, b) => b.share - a.share);
}

/** Pick the walls, trim and accent from the colour groups, and the closest style. */
export function readPalette(groups) {
  if (!groups.length) return null;
  // walls: the biggest group that is neither very dark nor strongly coloured
  const wallC = groups.find((g) => g.l > 0.45 && g.s < 0.55) || groups[0];
  // trim: the darkest group with a real share, or a contrasting light one
  const dark = groups.filter((g) => g.l < 0.3 && g.share > 0.03).sort((a, b) => b.share - a.share)[0];
  const trimC = dark || groups.filter((g) => g !== wallC).sort((a, b) => Math.abs(b.l - wallC.l) - Math.abs(a.l - wallC.l))[0] || wallC;
  const accentC = groups.filter((g) => g !== wallC && g !== trimC && g.s > 0.3 && g.l > 0.2 && g.l < 0.75).sort((a, b) => b.share * b.s - a.share * a.s)[0] || null;
  const wall = toHex(...wallC.rgb), trim = toHex(...trimC.rgb), accent = accentC ? toHex(...accentC.rgb) : null;
  // style: white or grey with a dark frame -> modern; warm cream or beige -> classic; terracotta, orange or red roofs -> Mediterranean
  let style = 'classic';
  const warm = wallC.h >= 20 && wallC.h <= 55 && wallC.s > 0.12;
  if (accentC && accentC.h <= 25 && accentC.s > 0.4) style = 'spanish';
  else if (wallC.l > 0.78 && wallC.s < 0.14 && trimC.l < 0.35) style = 'modern';
  else if (warm) style = 'classic';
  else if (wallC.s < 0.14) style = 'modern';
  return { wall, trim, accent, style, groups: groups.map((g) => toHex(...g.rgb)) };
}

/** Read a picture file in the browser. Resolves to { wall, trim, accent, style, groups, url } or null. */
export function readInspiration(file) {
  return new Promise((resolve) => {
    if (!file || !/^image\//.test(file.type)) return resolve(null);
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(1, 160 / Math.max(img.width, img.height)), w = Math.max(8, Math.round(img.width * s)), h = Math.max(8, Math.round(img.height * s));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h);
      const pal = readPalette(dominantColors(cx.getImageData(0, 0, w, h).data, w, h));
      resolve(pal ? { ...pal, url } : null);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
