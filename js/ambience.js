// The time of day: one number from 0 (early morning) through noon and sunset to 1 (night) sets where the sun stands, the
// colour of its light and of the sky, how much the rooms are lit by daylight, and how brightly the lamps shine.
import * as THREE from 'three';
import { setLampGlow } from './furn3d.js';

// t, sun height (deg), sun colour, sun strength, sky top, sky at the horizon, light from the sky / from the ground and its strength,
// exposure, lamps, room lights (x the daytime fill), reflections, ceiling glow
const KEYS = [
  { t: 0.00, el: 14, sun: '#ffd2a0', si: 1.9, top: '#6f9fd0', hor: '#f3d9c0', hs: '#dbe6f5', hg: '#77705c', hi: 0.62, ex: 1.0, glow: 0.25, fill: 0.85, env: 0.8, ceil: 0.36 },
  { t: 0.30, el: 62, sun: '#fff3e0', si: 3.0, top: '#5f97c9', hor: '#dfeaf0', hs: '#dcecff', hg: '#6e6650', hi: 0.78, ex: 1.05, glow: 0.12, fill: 0.85, env: 1.0, ceil: 0.42 },
  { t: 0.58, el: 26, sun: '#ffd9a8', si: 2.6, top: '#6b9bcb', hor: '#f1dcc0', hs: '#e3e6ee', hg: '#7a6c52', hi: 0.7, ex: 1.05, glow: 0.2, fill: 0.85, env: 0.9, ceil: 0.4 },
  { t: 0.72, el: 7, sun: '#ff9d5c', si: 2.3, top: '#5d78ad', hor: '#ffb27a', hs: '#f0cdb0', hg: '#6b5a48', hi: 0.52, ex: 1.08, glow: 0.7, fill: 1.0, env: 0.7, ceil: 0.34 },
  { t: 0.82, el: -4, sun: '#ff8a5c', si: 0.25, top: '#2f3f6e', hor: '#c9795e', hs: '#8f93b8', hg: '#3d3a40', hi: 0.3, ex: 1.1, glow: 1.5, fill: 1.25, env: 0.38, ceil: 0.16 },
  { t: 1.00, el: -30, sun: '#9fb4e0', si: 0.3, top: '#0b1226', hor: '#1c2542', hs: '#5a6796', hg: '#1c1c24', hi: 0.26, ex: 1.15, glow: 2.1, fill: 1.6, env: 0.16, ceil: 0.1 },
];
const NUM = ['el', 'si', 'hi', 'ex', 'glow', 'fill', 'env', 'ceil'], COL = ['sun', 'top', 'hor', 'hs', 'hg'];
const ca = new THREE.Color(), cb = new THREE.Color();
function at(t) {
  let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1], f = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))), k = f * f * (3 - 2 * f), o = {};
  for (const n of NUM) o[n] = a[n] + (b[n] - a[n]) * k;
  for (const n of COL) o[n] = '#' + ca.set(a[n]).lerp(cb.set(b[n]), k).getHexString();
  return o;
}

export const TIME_NAMES = [[0.12, 'Morning'], [0.45, 'Midday'], [0.66, 'Afternoon'], [0.78, 'Sunset'], [0.9, 'Dusk'], [2, 'Night']];
export const timeName = (t) => TIME_NAMES.find(([lim]) => t <= lim)[1];

let stars = null;
export function createAmbience(renderer) {
  const sky = document.createElement('canvas'); sky.width = 512; sky.height = 256;
  const g = sky.getContext('2d');
  let tex = null;
  if (!stars) { let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; stars = Array.from({ length: 220 }, () => [r() * 512, r() * 118, 0.5 + r() * 1.1, 0.4 + r() * 0.6]); }
  const dir = new THREE.Vector3();
  let mats = null, matsFor = null;

  /** Set the scene S (from buildScene) to time t. -> { fill, night, glow } for the lights that follow the visitor. */
  function apply(S, t) {
    const k = at(t), night = Math.max(0, Math.min(1, (t - 0.74) / 0.16));
    // the sun rises on the right of the plot, passes over the road side and sets on the left
    const az = Math.min(1, t / 0.8) * Math.PI, el = THREE.MathUtils.degToRad(Math.max(k.el, 4));
    dir.set(Math.cos(az) * Math.cos(el), Math.sin(el), -(0.35 + 0.65 * Math.sin(az)) * Math.cos(el)).normalize();
    const tg = S.sun.target.position;
    S.sun.position.set(tg.x + dir.x * 150, tg.y + dir.y * 150, tg.z + dir.z * 150);
    S.sun.color.set(k.sun); S.sun.intensity = k.si; S.sun.castShadow = k.si > 0.2;
    S.hemi.color.set(k.hs); S.hemi.groundColor.set(k.hg); S.hemi.intensity = k.hi;
    S.scene.fog.color.set(k.hor);
    renderer.toneMappingExposure = k.ex;
    S.mCeil.emissiveIntensity = k.ceil;
    S.mGlass.emissive.set('#ffc98a'); S.mGlass.emissiveIntensity = night * 0.55;       // lit windows, seen from the street
    S.mDownlight.color.set('#fff4d6').multiplyScalar(0.72 + 0.28 * night);
    setLampGlow(k.glow);
    if (matsFor !== S) { mats = S.envMaterials(); matsFor = S; }
    for (const m of mats) m.envMapIntensity = m.userData.env0 * k.env;
    // the sky: a gradient, a warm band where the sun is low, stars at night
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, k.top); gr.addColorStop(0.47, k.hor); gr.addColorStop(0.5, k.hor);
    gr.addColorStop(0.52, '#' + ca.set(k.hg).lerp(cb.set(k.hor), 0.35).getHexString()); gr.addColorStop(1, k.hg);
    g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
    if (k.el < 34 && k.si > 0.05) {
      const u = (Math.atan2(dir.z, dir.x) / (2 * Math.PI) + 0.5) * 512, y = 128 - (Math.max(k.el, -6) / 90) * 128, a = Math.min(1, (34 - k.el) / 26) * 0.85;
      for (const off of [-512, 0, 512]) { const rg = g.createRadialGradient(u + off, y, 2, u + off, y, 150); rg.addColorStop(0, `rgba(255,236,200,${a})`); rg.addColorStop(0.25, `rgba(255,170,100,${a * 0.55})`); rg.addColorStop(1, 'rgba(255,150,90,0)'); g.fillStyle = rg; g.fillRect(0, 0, 512, 150); }
    }
    if (night > 0.05) for (const [x, y, r, a] of stars) { g.fillStyle = `rgba(255,255,255,${a * night})`; g.fillRect(x, y, r, r); }
    // a new texture each time: the renderer keeps the sky it made from the old one
    const old = tex;
    tex = new THREE.CanvasTexture(sky); tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace;
    S.scene.background = tex;
    old?.dispose();
    return { fill: k.fill, night, glow: k.glow };
  }
  return { apply, forget() { mats = null; matsFor = null; }, dispose() { tex?.dispose(); } };
}
