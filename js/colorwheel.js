// A colour wheel you drag a marker round: angle is the colour, distance from the middle is how strong it is, the slider is dark to light.
// Opens beside the button that asked for it; the colour is handed back when you let go, so a 3D redraw is not run on every pixel of the drag.
let open = null;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function hsv2rgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
}
const hex = ([r, g, b]) => `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
function rgb2hsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
const parse = (str) => {
  const t0 = String(str || '').trim(), m = /^#?([0-9a-f]{6})$/i.exec(t0) || /^#?([0-9a-f]{3})$/i.exec(t0);
  if (!m) return null;
  const t = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => parseInt(t.slice(i, i + 2), 16));
};

const onKey = (e) => { if (e.key === 'Escape') closeWheel(); };
const onOutside = (e) => { if (open && !open.contains(e.target) && !e.target.closest('.swatch.custom')) closeWheel(); };
export function closeWheel() {
  if (!open) return;
  open.remove(); open = null;
  document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onOutside, true);
}

/** Show the wheel next to `anchor`. onPick(hex) runs when the visitor lets go of the marker or the slider, or types a colour. */
export function pickColor(anchor, start, onPick, title = 'Pick any colour') {
  closeWheel();
  const SZ = 208, R = SZ / 2 - 2;
  let [h, s, v] = rgb2hsv(parse(start) || [200, 160, 120]);
  const el = document.createElement('div');
  el.className = 'wheelpop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="wtitle">${title}</div><div class="wbox"><canvas width="${SZ * 2}" height="${SZ * 2}" style="width:${SZ}px;height:${SZ}px" aria-label="Colour wheel. Drag to choose."></canvas><i class="wmark"></i></div>`
    + '<label class="wlight">Darker<input type="range" min="12" max="100" aria-label="Lighter or darker"><span>Lighter</span></label>'
    + '<div class="wrow"><i class="wprev"></i><input class="whex" maxlength="7" spellcheck="false" aria-label="Colour code"><button type="button" class="wdone">Done</button></div>';
  document.body.appendChild(el); open = el;
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d'), mark = el.querySelector('.wmark'), light = el.querySelector('input[type=range]'), hexIn = el.querySelector('.whex'), prev = el.querySelector('.wprev');
  const draw = () => {
    const img = ctx.createImageData(SZ * 2, SZ * 2), c = SZ, r2 = R * 2;
    for (let y = 0; y < SZ * 2; y++) for (let x = 0; x < SZ * 2; x++) {
      const dx = x - c, dy = y - c, d = Math.hypot(dx, dy), i = (y * SZ * 2 + x) * 4;
      if (d > r2) continue;
      const [rr, gg, bb] = hsv2rgb(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, Math.min(1, d / r2), v);
      img.data[i] = rr; img.data[i + 1] = gg; img.data[i + 2] = bb; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  };
  const show = () => {
    const a = (h * Math.PI) / 180, d = s * R, cur = hex(hsv2rgb(h, s, v));
    mark.style.left = `${SZ / 2 + Math.cos(a) * d}px`; mark.style.top = `${SZ / 2 + Math.sin(a) * d}px`; mark.style.background = cur;
    prev.style.background = cur;
    if (document.activeElement !== hexIn) hexIn.value = cur;
    light.value = String(Math.round(v * 100));
    return cur;
  };
  const at = (e) => {
    const b = cv.getBoundingClientRect(), dx = e.clientX - b.left - b.width / 2, dy = e.clientY - b.top - b.height / 2;
    h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360; s = clamp(Math.hypot(dx, dy) / (R * (b.width / SZ)), 0, 1); show();
  };
  let down = false;
  cv.addEventListener('pointerdown', (e) => { down = true; cv.setPointerCapture(e.pointerId); at(e); });
  cv.addEventListener('pointermove', (e) => { if (down) at(e); });
  const end = () => { if (down) { down = false; onPick(show()); } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  light.addEventListener('input', () => { v = +light.value / 100; draw(); show(); });
  light.addEventListener('change', () => onPick(show()));
  hexIn.addEventListener('input', () => { const c = parse(hexIn.value); if (c) { [h, s, v] = rgb2hsv(c); draw(); show(); } });
  hexIn.addEventListener('change', () => { const c = parse(hexIn.value); if (c) onPick(hex(c)); });
  el.querySelector('.wdone').onclick = closeWheel;
  draw(); show();
  const b = anchor.getBoundingClientRect(), w = 244, hgt = 340;
  el.style.left = `${clamp(b.left + b.width / 2 - w / 2, 8, window.innerWidth - w - 8)}px`;
  el.style.top = `${b.bottom + 10 + hgt > window.innerHeight ? Math.max(8, b.top - hgt - 10) : b.bottom + 10}px`;
  document.addEventListener('keydown', onKey, true); document.addEventListener('pointerdown', onOutside, true);
  return el;
}
