import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STYLES } from './styles.js';
import { furnish } from './furniture.js';
import { addFurniture, furnitureColliders } from './furn3d.js';

const H = 10; // wall height (ft)
const EYE = 5.4;
const SLAB = 0.6, STOREY = H + SLAB;                                // thickness of the floor slab, floor-to-floor height

// ---------- procedural textures (drawn once, shared) ----------
const texCache = new Map();
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function makeTex(kind) {
  if (texCache.has(kind)) return texCache.get(kind);
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const speckle = (n, a, s = 2, col = '0,0,0') => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${col},${rnd() * a})`; g.fillRect(rnd() * N, rnd() * N, s, s); } };
  const blotch = (n, a, r, col = '0,0,0') => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * N, y = rnd() * N, rr = r * (0.4 + rnd());
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, `rgba(${col},${a * rnd()})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
    }
  };
  if (kind === 'wood' || kind === 'wood-dark' || kind === 'slats') {
    const base = kind === 'wood' ? [196, 150, 100] : kind === 'slats' ? [150, 100, 64] : [130, 86, 54];
    const n = kind === 'slats' ? 12 : 8, pw = N / n;
    for (let i = 0; i < n; i++) {
      const v = (rnd() - 0.5) * 26;
      g.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v})`;
      g.fillRect(i * pw, 0, pw, N);
      for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(60,30,10,${rnd() * 0.12})`; g.fillRect(i * pw + rnd() * pw, 0, 1 + rnd() * 2, N); }
      g.fillStyle = kind === 'slats' ? 'rgba(20,10,5,.7)' : 'rgba(0,0,0,.25)'; g.fillRect(i * pw, 0, kind === 'slats' ? 5 : 2, N);
      if (kind !== 'slats') g.fillRect(i * pw, rnd() * N, pw, 2);
    }
  } else if (kind === 'plaster' || kind === 'plaster-fine') {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, N, N);
    blotch(kind === 'plaster' ? 30 : 12, 0.018, 70);
    speckle(kind === 'plaster' ? 9000 : 4000, 0.06, 2);
    speckle(1500, 0.08, 1, '255,255,255');
  } else if (kind === 'stone') {                                  // plinth: cut stone blocks
    g.fillStyle = '#8f8a80'; g.fillRect(0, 0, N, N);
    const rows = 4, rh = N / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 80;
      while (x < N) {
        const bw = 90 + rnd() * 90, v = (rnd() - 0.5) * 34;
        g.fillStyle = `rgb(${150 + v},${144 + v},${132 + v})`;
        g.fillRect(x + 3, r * rh + 3, bw - 6, rh - 6);
        x += bw;
      }
    }
    speckle(6000, 0.12, 2);
  } else if (kind === 'brick') {
    g.fillStyle = '#d9cfc0'; g.fillRect(0, 0, N, N);
    const rows = 16, rh = N / rows;
    for (let r = 0; r < rows; r++) for (let x = (r % 2) * -32; x < N; x += 64) {
      const v = (rnd() - 0.5) * 30;
      g.fillStyle = `rgb(${172 + v},${88 + v * 0.6},${62 + v * 0.4})`; g.fillRect(x + 2, r * rh + 2, 60, rh - 4);
    }
    speckle(4000, 0.12, 2);
  } else if (kind === 'grass') {
    g.fillStyle = '#6f9a4e'; g.fillRect(0, 0, N, N);
    blotch(80, 0.18, 70, '40,70,20'); blotch(50, 0.12, 60, '170,190,90');
    speckle(14000, 0.18, 2, '30,60,15'); speckle(6000, 0.15, 2, '190,210,120');
  } else if (kind === 'asphalt') {
    g.fillStyle = '#4b4d50'; g.fillRect(0, 0, N, N);
    speckle(20000, 0.25, 2); speckle(9000, 0.12, 2, '255,255,255'); blotch(20, 0.12, 80);
  } else if (kind === 'paving') {                                 // driveway and sidewalk tiles
    g.fillStyle = '#b7b1a5'; g.fillRect(0, 0, N, N);
    const s = N / 4;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = (rnd() - 0.5) * 22; g.fillStyle = `rgb(${196 + v},${190 + v},${178 + v})`; g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6); }
    speckle(5000, 0.1, 2);
  } else if (kind === 'concrete') {
    g.fillStyle = '#c9c5bc'; g.fillRect(0, 0, N, N);
    blotch(50, 0.1, 70); speckle(9000, 0.08, 2);
  } else {
    const base = { marble: '#ecE9e2', 'marble-warm': '#e8dcc4', terracotta: '#c9774c', tile: '#cfe0e6', roofTile: '#b0532f' }[kind] || '#ddd';
    g.fillStyle = base; g.fillRect(0, 0, N, N);
    if (kind.startsWith('marble')) { blotch(40, 0.06, 90); for (let i = 0; i < 12; i++) { g.strokeStyle = `rgba(120,110,100,${0.08 + rnd() * 0.1})`; g.lineWidth = 1 + rnd() * 2; g.beginPath(); g.moveTo(rnd() * N, rnd() * N); for (let k = 0; k < 5; k++) g.lineTo(rnd() * N, rnd() * N); g.stroke(); } }
    speckle(500, 0.05);
    g.strokeStyle = kind === 'terracotta' || kind === 'roofTile' ? 'rgba(90,40,20,.45)' : 'rgba(0,0,0,.18)';
    g.lineWidth = 3;
    const step = kind === 'tile' ? 128 : kind === 'roofTile' ? 64 : 256;
    for (let p = 0; p <= N; p += step) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, N); g.moveTo(0, p); g.lineTo(N, p); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(kind, t);
  return t;
}
function skyTexture() {
  if (texCache.has('sky')) return texCache.get('sky');
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#5f97c9'); gr.addColorStop(0.42, '#a9cbe6'); gr.addColorStop(0.5, '#e4ecee'); gr.addColorStop(0.52, '#cfd3c4'); gr.addColorStop(1, '#a9ad98');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  texCache.set('sky', t);
  return t;
}
const envCache = new WeakMap();
function envFor(renderer) {
  if (!envCache.has(renderer)) {
    const pm = new THREE.PMREMGenerator(renderer);
    envCache.set(renderer, pm.fromScene(new RoomEnvironment(), 0.04).texture);
    pm.dispose();
  }
  return envCache.get(renderer);
}

// box UVs in feet, so a texture keeps its real size on a wall of any length (tile = feet per texture repeat)
function feetUV(geo, dx, dy, dz, tile) {
  const uv = geo.attributes.uv;
  const dims = [[dz, dy], [dz, dy], [dx, dz], [dx, dz], [dx, dy], [dx, dy]];   // +x -x +y -y +z -z faces
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
}

export function prepareRenderer(renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

/**
 * The house as a scene: walls, floors, roof, facade details, plot, street and (optionally) furniture.
 * L: ground floor layout; U: first floor of a two-storey house (or null). colors: { wall, trim, interior, accent } overrides.
 */
export function buildScene(renderer, L, styleId, U = null, { colors = {}, furniture = true, context = false } = {}) {
  const st = { ...STYLES[styleId], ...Object.fromEntries(Object.entries(colors).filter(([, v]) => v)) };
  const { w: W, d: D } = L.plot;
  const { B, rule } = L;

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.environment = envFor(renderer);
  scene.fog = new THREE.Fog('#dce6ea', 260, 900);

  scene.add(new THREE.HemisphereLight('#e3f0ff', '#6e6650', 0.9));
  const sun = new THREE.DirectionalLight('#fff1da', 2.7);
  sun.position.set(W * 0.5 - 70, 95, -85);
  sun.target.position.set(W / 2, 0, D / 2);
  scene.add(sun, sun.target);
  sun.castShadow = true;
  const ext = Math.max(W, D) * 0.75 + 25;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 400 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;

  const matCache = new Map();
  const mat = (color, o = {}) => {
    const k = color + JSON.stringify(o);
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, envMapIntensity: 0.45, ...o }));
    return matCache.get(k);
  };
  const texMat = (kind, o = {}, tile = 8) => { const m = new THREE.MeshStandardMaterial({ map: makeTex(kind), roughness: 0.9, envMapIntensity: 0.35, ...o }); m.userData.tile = tile; return m; };
  const mExt = texMat('plaster', { color: st.wall, bumpMap: makeTex('plaster'), bumpScale: 0.02, roughness: 0.95 }, 9);
  const mInt = texMat('plaster-fine', { color: st.interior, roughness: 0.92, envMapIntensity: 0.55 }, 9);
  const mTrim = mat(st.trim, { roughness: 0.7 }), mAccent = mat(st.accent, { roughness: 0.75 });
  const mGlass = new THREE.MeshStandardMaterial({ color: '#4f6d7d', metalness: 0.25, roughness: 0.04, transparent: true, opacity: 0.42, envMapIntensity: 1.6 });
  const mFrame = mat(st.frame, { roughness: 0.45, metalness: 0.3 });
  const mStone = texMat('stone', { roughness: 0.8 }, 4);
  const mDoor = texMat('wood-dark', { roughness: 0.6 }, 3);
  const mSlats = texMat('slats', { roughness: 0.65 }, 3);
  const mGrill = mat('#2a2d30', { roughness: 0.45, metalness: 0.6 });
  const mRoofTile = texMat('roofTile', { roughness: 0.75 }, 3);
  const mConcrete = texMat('concrete', { roughness: 0.95 }, 10);
  const world = new THREE.Group(); scene.add(world);
  const roofG = new THREE.Group(); world.add(roofG);
  const colliders = [], upperColliders = [];
  const furnReady = [];                                            // furniture models arrive after the walls: the house is usable at once
  let curColl = colliders;                                         // where wall boxes register their collision (the storey being built)

  const box = (parent, x0, x1, y0, y1, z0, z1, m, collide, cast = true) => {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return null;
    const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    if (m.map) feetUV(geo, x1 - x0, y1 - y0, z1 - z0, m.userData.tile || 8);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.castShadow = cast; mesh.receiveShadow = true;
    parent.add(mesh);
    if (collide) curColl.push({ x0, x1, z0, z1 });
    return mesh;
  };
  const bx = (parent, cx, cy, cz, w, h, d, m) => box(parent, cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2, m);

  // ---------- ground, street ----------
  const plane = (x0, x1, z0, z1, y, m, parent = world) => {
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    if (m.map) { const uv = geo.attributes.uv, t = m.userData.tile || 8; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / t, uv.getY(i) * (z1 - z0) / t); }
    const p = new THREE.Mesh(geo, m);
    p.rotation.x = -Math.PI / 2; p.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); p.receiveShadow = true; parent.add(p); return p;
  };
  const mGrass = texMat('grass', { roughness: 1 }, 12), mAsphalt = texMat('asphalt', { roughness: 0.95 }, 14), mPave = texMat('paving', { roughness: 0.9 }, 4);
  plane(-500, 500, -500, 500, -0.06, mGrass);
  plane(-500, 500, -40, -8, -0.03, mAsphalt);
  plane(-500, 500, -8, 0, -0.01, mPave);
  plane(-500, 500, -52, -40, -0.01, mPave);
  for (let x = -260; x < 260; x += 14) plane(x, x + 6, -24.35, -23.65, -0.02, mat('#ece8d2'));
  box(world, -500, 500, -0.05, 0.45, -8.4, -8, mConcrete, false, false);                // kerbs
  box(world, -500, 500, -0.05, 0.45, -40, -39.6, mConcrete, false, false);
  plane(0, W, 0, D, 0, mGrass);
  plane(0, W, 0, B.z, 0.01, mPave);

  // open spaces inside the house outline: the car porch beside the drawing room (small plots) and light wells
  const open = L.open || [];
  const porch = open.find((p) => p.type === 'porch');
  const innerPorch = porch && porch.z >= B.z - 0.01 ? porch : null;  // beside the drawing room, under the main roof (small plots)
  for (const p of open) plane(p.x, p.x + p.w, p.z, p.z + p.d, 0.02, p.type === 'porch' ? mPave : mGrass);

  // compound wall with a coping, gate pillars and a sliding metal gate parked beside the gateway
  const mainDoor = L.openings.find((p) => p.main);
  const gateX = mainDoor.at;
  const gateLo = porch ? Math.max(0.6, Math.min(porch.x, gateX - 2)) : gateX - 4;
  const gateHi = porch ? Math.min(W - 0.6, Math.max(porch.x + porch.w, gateX + 2)) : gateX + 4;
  const cw = 0.5, ch = 4.5;
  const cwall = (x0, x1, z0, z1) => {
    box(world, x0, x1, 0, ch, z0, z1, mExt, true);
    box(world, x0 - 0.12, x1 + 0.12, ch, ch + 0.3, z0 - 0.12, z1 + 0.12, mTrim);
    box(world, x0 - 0.04, x1 + 0.04, 0, 1, z0 - 0.04, z1 + 0.04, mStone, false);
  };
  cwall(0, gateLo, -cw / 2, cw / 2);
  cwall(gateHi, W, -cw / 2, cw / 2);
  cwall(0, W, D - cw / 2, D + cw / 2);
  if (rule.side > 0) { cwall(-cw / 2, cw / 2, 0, D); cwall(W - cw / 2, W + cw / 2, 0, D); }
  [gateLo - 0.4, gateHi + 0.4].forEach((x) => { box(world, x - 0.7, x + 0.7, 0, 6, -0.75, 0.75, mStone, true); box(world, x - 0.85, x + 0.85, 6, 6.4, -0.9, 0.9, mTrim); });
  {
    const gw = gateHi - gateLo, right = gateHi + gw <= W - 0.4;
    const g0 = right ? gateHi + 0.3 : gateLo - gw - 0.3, g1 = g0 + gw, z0 = 0.35, z1 = 0.5;
    box(world, g0, g1, 0.2, 0.45, z0, z1, mGrill); box(world, g0, g1, 5.0, 5.3, z0, z1, mGrill);
    for (let x = g0 + 0.25; x < g1; x += 0.45) box(world, x - 0.04, x + 0.04, 0.2, 5.3, z0 + 0.03, z1 - 0.03, mGrill, false);
  }

  // ---------- walls, floors, furniture: one storey (dy = height of its floor) ----------
  function buildStorey(L, dy, upper) {
    const { B } = L;
    const open = L.open || [];
    const walls = new THREE.Group(); walls.position.y = dy; world.add(walls);
    curColl = upper ? upperColliders : colliders;
    const hl = new Map(), vl = new Map();
    const addEdge = (map, c, a, b) => {
      const k = Math.round(c * 100);
      if (!map.has(k)) map.set(k, { c, iv: [] });
      map.get(k).iv.push([a, b]);
    };
    for (const r of L.rooms) {
      addEdge(hl, r.z, r.x, r.x + r.w); addEdge(hl, r.z + r.d, r.x, r.x + r.w);
      addEdge(vl, r.x, r.z, r.z + r.d); addEdge(vl, r.x + r.w, r.z, r.z + r.d);
    }
    const merge = (iv) => {
      iv.sort((a, b) => a[0] - b[0]);
      const out = [];
      for (const [a, b] of iv) {
        if (out.length && a <= out[out.length - 1][1] + 0.01) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
        else out.push([a, b]);
      }
      return out;
    };
    const eq = (a, b) => Math.abs(a - b) < 0.02;

    // stretches of a wall line that face an open space are outside walls too (inDir = which side is indoors)
    const openSpans = (o, c) => open.flatMap((p) => {
      if (o === 'h') return eq(c, p.z + p.d) ? [{ a: p.x, b: p.x + p.w, inDir: 1 }] : eq(c, p.z) ? [{ a: p.x, b: p.x + p.w, inDir: -1 }] : [];
      return eq(c, p.x + p.w) ? [{ a: p.z, b: p.z + p.d, inDir: 1 }] : eq(c, p.x) ? [{ a: p.z, b: p.z + p.d, inDir: -1 }] : [];
    });

    const addLine = (o, line) => {
      const c = line.c;
      let bOuter = false, bDir = 1;
      if (o === 'h') { if (eq(c, B.z)) { bOuter = true; bDir = 1; } else if (eq(c, B.z + B.d)) { bOuter = true; bDir = -1; } }
      else { if (eq(c, B.x)) { bOuter = true; bDir = 1; } else if (eq(c, B.x + B.w)) { bOuter = true; bDir = -1; } }
      const spans = openSpans(o, c);
      for (const [a0, b0] of merge(line.iv)) {
        // split at the edges of open spaces so each run is either an outside wall or an inside one
        const cuts = [a0, ...spans.flatMap((s) => [s.a, s.b]).filter((v) => v > a0 + 0.01 && v < b0 - 0.01), b0].sort((x, y) => x - y);
        for (let i = 0; i < cuts.length - 1; i++) {
          const a = cuts[i], b = cuts[i + 1];
          if (b - a < 0.01) continue;
          const sp = spans.find((s) => (a + b) / 2 > s.a && (a + b) / 2 < s.b);
          wallRun(o, c, a, b, bOuter || !!sp, bOuter ? bDir : sp ? sp.inDir : 1, a === a0, b === b0);
        }
      }
    };

    const wallRun = (o, c, a, b, outer, inDir, capA, capB) => {
      const t = outer ? 0.75 : 0.4;
      const outFace = c - inDir * t / 2;                         // the outside face of an outer wall
      const piece = (s0, s1, y0, y1, collide) => {
        if (s1 - s0 < 0.01) return;
        if (o === 'h') {
          box(walls, s0, s1, y0, y1, c - t / 2, c + t / 2, outer ? mExt : mInt, collide);
          if (outer) box(walls, s0, s1, y0, y1, inDir > 0 ? c + t / 2 : c - t / 2 - 0.04, inDir > 0 ? c + t / 2 + 0.04 : c - t / 2, mInt, false, false);
          if (outer && !upper && y0 === 0) box(walls, s0, s1, 0, Math.min(1.4, y1), inDir > 0 ? outFace - 0.07 : outFace, inDir > 0 ? outFace : outFace + 0.07, mStone, false, false);
        } else {
          box(walls, c - t / 2, c + t / 2, y0, y1, s0, s1, outer ? mExt : mInt, collide);
          if (outer) box(walls, inDir > 0 ? c + t / 2 : c - t / 2 - 0.04, inDir > 0 ? c + t / 2 + 0.04 : c - t / 2, y0, y1, s0, s1, mInt, false, false);
          if (outer && !upper && y0 === 0) box(walls, inDir > 0 ? outFace - 0.07 : outFace, inDir > 0 ? outFace : outFace + 0.07, 0, Math.min(1.4, y1), s0, s1, mStone, false, false);
        }
      };
      const ops = L.openings.filter((p) => p.o === o && eq(p.c, c) && p.at - p.w / 2 >= a - 0.02 && p.at + p.w / 2 <= b + 0.02).sort((p, q) => p.at - q.at);
      let cur = a;
      const solid = (s0, s1) => piece(s0 === a && capA ? s0 - t / 2 : s0, s1 === b && capB ? s1 + t / 2 : s1, 0, H, true);
      for (const p of ops) {
        const o0 = p.at - p.w / 2, o1 = p.at + p.w / 2;
        solid(cur, o0);
        if (p.sill > 0) piece(o0, o1, 0, p.sill, true);
        piece(o0, o1, p.top, H, false);
        decorate(o, c, p, outer, inDir, t);
        cur = o1;
      }
      solid(cur, b);
    };

    // which side of a wall a room lies on (+1: the larger coordinate)
    const sideOf = (id, o, c) => {
      const r = L.rooms.find((q) => q.id === id);
      if (!r) return 1;
      return o === 'h' ? (r.z + r.d / 2 > c ? 1 : -1) : (r.x + r.w / 2 > c ? 1 : -1);
    };
    function decorate(o, c, p, outer, inDir, t) {
      const o0 = p.at - p.w / 2, o1 = p.at + p.w / 2, fw = 0.2;
      const along = (s0, s1, y0, y1, th, m, off = 0) => (o === 'h'
        ? box(walls, s0, s1, y0, y1, c + off - th, c + off + th, m, false) : box(walls, c + off - th, c + off + th, y0, y1, s0, s1, m, false));
      const outSide = -inDir;                                    // direction of the outside, for outer walls
      if (p.kind === 'window') {
        along(o0, o1, p.sill, p.top, 0.04, mGlass);
        along(o0 - fw, o1 + fw, p.top, p.top + fw, 0.22, mFrame);
        along(o0 - fw, o0, p.sill, p.top, 0.22, mFrame);
        along(o1, o1 + fw, p.sill, p.top, 0.22, mFrame);
        along((o0 + o1) / 2 - 0.06, (o0 + o1) / 2 + 0.06, p.sill, p.top, 0.12, mFrame);
        if (outer) {
          const out = outSide * (t / 2 + 0.25);
          along(o0 - 0.45, o1 + 0.45, p.sill - 0.25, p.sill, 0.28, st.id === 'modern' ? mFrame : mTrim, out * 0.6);        // sill
          along(o0 - 0.7, o1 + 0.7, p.top + 0.35, p.top + 0.62, 0.85, st.id === 'spanish' ? mRoofTile : mTrim, outSide * (t / 2 + 0.85));   // chajja (sunshade)
          if (st.id === 'classic') {                               // moulded surround
            along(o0 - 0.55, o0 - 0.2, p.sill, p.top + 0.35, 0.12, mTrim, outSide * (t / 2 + 0.06));
            along(o1 + 0.2, o1 + 0.55, p.sill, p.top + 0.35, 0.12, mTrim, outSide * (t / 2 + 0.06));
          }
          if (!upper && !p.bath) for (let s = o0 + 0.35; s < o1 - 0.1; s += 0.5) along(s - 0.03, s + 0.03, p.sill, p.top, 0.03, mGrill, outSide * (t / 2 + 0.12));   // security grill
          if (!upper && !p.bath) along(o0, o1, p.sill + (p.top - p.sill) / 2 - 0.03, p.sill + (p.top - p.sill) / 2 + 0.03, 0.03, mGrill, outSide * (t / 2 + 0.12));
        }
      } else if (p.kind === 'door') {
        along(o0 - fw, o1 + fw, p.top, p.top + fw, 0.3, mFrame);
        along(o0 - fw, o0, 0, p.top, 0.3, mFrame);
        along(o1, o1 + fw, 0, p.top, 0.3, mFrame);
        // the leaf, swung open against the room it belongs to
        const into = outer ? inDir : sideOf(p.room, o, c);
        const leafLen = p.w - 0.1, th = 0.15, hinge = o0 + 0.08;
        const m = p.main ? (st.id === 'modern' ? mSlats : mDoor) : p.room?.startsWith('bath') ? mat('#e9e6df', { roughness: 0.5 }) : mDoor;
        if (o === 'h') box(walls, hinge, hinge + th, 0.05, p.top - 0.05, into > 0 ? c + t / 2 : c - t / 2 - leafLen, into > 0 ? c + t / 2 + leafLen : c - t / 2, m, false);
        else box(walls, into > 0 ? c + t / 2 : c - t / 2 - leafLen, into > 0 ? c + t / 2 + leafLen : c - t / 2, 0.05, p.top - 0.05, hinge, hinge + th, m, false);
        if (outer) along(o0 - 0.8, o1 + 0.8, p.top + 0.45, p.top + 0.72, 0.9, st.id === 'spanish' ? mRoofTile : mTrim, outSide * (t / 2 + 0.9));
        if (p.main) {                                             // lights beside the entrance
          const lm = mat('#fff3d0', { emissive: '#ffd890', emissiveIntensity: 1.2 });
          along(o0 - 0.75, o0 - 0.45, 6.2, 6.8, 0.12, lm, outSide * (t / 2 + 0.12));
          along(o1 + 0.45, o1 + 0.75, 6.2, 6.8, 0.12, lm, outSide * (t / 2 + 0.12));
        }
      }
    }

    for (const l of hl.values()) addLine('h', l);
    for (const l of vl.values()) addLine('v', l);

    // ---------- floors ----------
    const floorMat = (kind) => texMat(kind, { roughness: kind.startsWith('marble') ? 0.35 : kind === 'tile' ? 0.4 : 0.7, envMapIntensity: kind.startsWith('marble') ? 0.8 : 0.4 }, kind === 'tile' ? 2.5 : 4);
    const fm = {};
    const floorKind = (r) => (r.type.endsWith('bath') || r.type === 'kitchen' ? 'tile' : r.type === 'bed' ? st.floorBed : st.floorLiving);
    const order = [...L.rooms.filter((r) => !r.parent), ...L.rooms.filter((r) => r.parent)];
    order.forEach((r) => {
      if (upper && r.type === 'stairs') return;                    // the stairwell: open down to the stairs below
      const k = floorKind(r);
      plane(r.x, r.x + r.w, r.z, r.z + r.d, r.parent ? 0.05 : 0.03, fm[k] ||= floorMat(k), walls);
    });
    // a ceiling under every slab (the roof's underside), so rooms look finished from inside
    for (const r of L.rooms) if (!r.parent) { const cp = plane(r.x, r.x + r.w, r.z, r.z + r.d, H - 0.02, mat('#f6f4ef', { roughness: 0.95, emissive: '#3b3934' }), walls); cp.rotation.x = Math.PI / 2; }

    const pieces = L.furniture || furnish(L);
    curColl.push(...furnitureColliders(pieces));
    if (furniture) {
      const furn = new THREE.Group(); walls.add(furn);
      furnReady.push(addFurniture(furn, pieces));
    }
    return pieces;
  }
  const piecesG = buildStorey(L, 0, false);
  const piecesU = U ? buildStorey(U, STOREY, true) : [];
  curColl = colliders;
  const stairsRoom = L.rooms.find((r) => r.type === 'stairs');
  const upStairs = U && U.rooms.find((r) => r.type === 'stairs');

  // ---------- roof ----------
  // slab over a storey (with a stairwell hole when the storey above reaches it), a parapet round it, a cornice, a water tank
  const ov = 0.45;
  const pm = st.id === 'spanish' ? mExt : st.id === 'modern' ? mTrim : mExt;
  // cover: rooms of the storey above; the parapet runs only where the roof edge is open (the terrace), not under its walls
  const roofOf = (B, y, parent, ph, hole, top, cover = null) => {   // y: top of the walls
    const x0 = B.x - ov, x1 = B.x + B.w + ov, z0 = B.z - ov, z1 = B.z + B.d + ov, pt = 0.6, m = mConcrete;
    const near = (a, b) => Math.abs(a - b) < 0.06;
    const freeSpans = (o, c, lo, hi) => {                         // parts of an edge with no room of the storey above on it
      if (!cover) return [[lo, hi]];
      const cuts = cover.filter((r) => (o === 'h' ? near(r.z, c) || near(r.z + r.d, c) : near(r.x, c) || near(r.x + r.w, c)))
        .map((r) => (o === 'h' ? [r.x, r.x + r.w] : [r.z, r.z + r.d])).sort((a, b) => a[0] - b[0]);
      const out = []; let cur = lo;
      for (const [a, b] of cuts) { if (a > cur + 0.3) out.push([cur, a]); cur = Math.max(cur, b); }
      if (hi > cur + 0.3) out.push([cur, hi]);
      return out.map(([a, b]) => [near(a, lo + ov) || a <= lo + ov + 0.01 ? lo : a, near(b, hi - ov) || b >= hi - ov - 0.01 ? hi : b]);
    };
    if (hole) {
      const hx0 = hole.x, hx1 = hole.x + hole.w, hz0 = hole.z, hz1 = hole.z + hole.d;
      box(parent, x0, x1, y, y + SLAB, z0, hz0, m); box(parent, x0, x1, y, y + SLAB, hz1, z1, m);
      box(parent, x0, hx0, y, y + SLAB, hz0, hz1, m); box(parent, hx1, x1, y, y + SLAB, hz0, hz1, m);
    } else box(parent, x0, x1, y, y + SLAB, z0, z1, m);
    box(parent, x0 - 0.15, x1 + 0.15, y - 0.05, y + SLAB + 0.05, z0 - 0.15, z0, mTrim);     // slab edge band (front)
    const capM = st.id === 'spanish' ? mRoofTile : mTrim;                                       // coping on the parapet
    const y0 = y + SLAB, y1 = y + SLAB + ph, c1 = y1 + 0.22;
    for (const [a, b] of freeSpans('h', B.z, x0, x1)) { box(parent, a, b, y0, y1, z0, z0 + pt, pm); box(parent, a - 0.1, b + 0.1, y1, c1, z0 - 0.1, z0 + pt + 0.1, capM); }
    for (const [a, b] of freeSpans('h', B.z + B.d, x0, x1)) { box(parent, a, b, y0, y1, z1 - pt, z1, pm); box(parent, a - 0.1, b + 0.1, y1, c1, z1 - pt - 0.1, z1 + 0.1, capM); }
    for (const [a, b] of freeSpans('v', B.x, z0, z1)) { box(parent, x0, x0 + pt, y0, y1, a, b, pm); box(parent, x0 - 0.1, x0 + pt + 0.1, y1, c1, a, b, capM); }
    for (const [a, b] of freeSpans('v', B.x + B.w, z0, z1)) { box(parent, x1 - pt, x1, y0, y1, a, b, pm); box(parent, x1 - pt - 0.1, x1 + 0.1, y1, c1, a, b, capM); }
    if (st.id === 'spanish' && freeSpans('h', B.z, x0, x1).length) {                                     // a sloping tiled hood along the front, under the parapet
      const tilt = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 1, 0.25, 2.2), mRoofTile);
      tilt.position.set((x0 + x1) / 2, y + SLAB + ph * 0.45, z0 - 0.7); tilt.rotation.x = -0.45; tilt.castShadow = true; parent.add(tilt);
    }
    if (st.id === 'classic') {
      box(parent, B.x - 1, B.x + B.w + 1, y + SLAB + ph, y + 0.4 + ph + SLAB, B.z - 1, B.z + B.d + 1, mTrim);
      const c0 = 0.9, ct = 0.6, cx0 = B.x - c0, cx1 = B.x + B.w + c0, cz0 = B.z - c0, cz1 = B.z + B.d + c0;
      box(world, cx0, cx1, y - 0.7, y, cz0, cz0 + ct, mTrim); box(world, cx0, cx1, y - 0.7, y, cz1 - ct, cz1, mTrim);
      box(world, cx0, cx0 + ct, y - 0.7, y, cz0, cz1, mTrim); box(world, cx1 - ct, cx1, y - 0.7, y, cz0, cz1, mTrim);
    }
    if (top) {
      box(parent, B.x + B.w - 5, B.x + B.w - 2, y + SLAB, y + SLAB + 2.8, B.z + B.d - 4, B.z + B.d - 1.5, mat('#2f3f4a', { roughness: 0.5 }));   // water tank
      box(parent, B.x + B.w - 5.3, B.x + B.w - 1.7, y + SLAB + 2.8, y + SLAB + 3.0, B.z + B.d - 4.3, B.z + B.d - 1.2, mat('#3b4d59'));
      for (let i = 0; i < 2; i++) box(parent, B.x + 2 + i * 3.5, B.x + 4.6 + i * 3.5, y + SLAB, y + SLAB + 1.9, B.z + B.d - 2.6, B.z + B.d - 1.4, mat('#d9dcdc', { roughness: 0.5, metalness: 0.2 }));   // AC units
    }
  };
  if (!U) roofOf(B, H, roofG, 2.6, null, true);
  else {
    roofOf(B, H, world, 3, stairsRoom, false, U.rooms.filter((r) => !r.parent));   // the ground floor's roof is the upstairs floor, and its open part the terrace
    roofOf(U.B, STOREY + H, roofG, 2.6, null, true);
    // a guard wall round the terrace edge keeps walkers on the slab
    upperColliders.push({ x0: B.x - 2, x1: B.x - 0.4, z0: B.z - 2, z1: B.z + B.d + 2 }, { x0: B.x + B.w + 0.4, x1: B.x + B.w + 2, z0: B.z - 2, z1: B.z + B.d + 2 },
      { x0: B.x - 2, x1: B.x + B.w + 2, z0: B.z - 2, z1: B.z - 0.4 }, { x0: B.x - 2, x1: B.x + B.w + 2, z0: B.z + B.d + 0.4, z1: B.z + B.d + 2 });
    if (stairsRoom) {                                             // the flight: steps climbing along the longer side of the stairs room
      const alongX = stairsRoom.w > stairsRoom.d, len = alongX ? stairsRoom.w : stairsRoom.d, n = 16, run = len / n;
      const mStep = st.floorLiving.startsWith('marble') ? texMat(st.floorLiving, { roughness: 0.35 }, 4) : mTrim;
      for (let i = 0; i < n; i++) {
        const top = ((i + 1) / n) * STOREY;
        if (alongX) box(world, stairsRoom.x + i * run, stairsRoom.x + (i + 1) * run, 0, top, stairsRoom.z + 0.2, stairsRoom.z + stairsRoom.d - 0.2, mStep);
        else box(world, stairsRoom.x + 0.2, stairsRoom.x + stairsRoom.w - 0.2, 0, top, stairsRoom.z + i * run, stairsRoom.z + (i + 1) * run, mStep);
      }
    }
  }

  // ---------- porch ----------
  const pd = Math.min(rule.front - 1, 7);
  if (!innerPorch) {                                             // veranda canopy across the front (the car porch is under the main roof)
    box(world, B.x - 0.4, B.x + B.w + 0.4, 9.3, 9.8, B.z - pd, B.z + 0.4, st.id === 'spanish' ? mRoofTile : mTrim);
    if (st.id === 'spanish') box(world, B.x - 0.4, B.x + B.w + 0.4, 9.8, 10.1, B.z - pd, B.z - pd + 0.5, mat('#8e3f22'));
  }
  if (st.deco === 'wood') {                                      // timber cladding round the entrance
    const dx0 = mainDoor.at - mainDoor.w / 2 - 0.2, dx1 = mainDoor.at + mainDoor.w / 2 + 0.2;
    box(world, dx0 - 1.6, dx0, 0, H, B.z - 0.45, B.z - 0.2, mSlats);
    box(world, dx1, dx1 + 1.6, 0, H, B.z - 0.45, B.z - 0.2, mSlats);
    box(world, dx0, dx1, 7.4, H, B.z - 0.45, B.z - 0.2, mSlats);
  }
  // front steps up to the entrance
  box(world, mainDoor.at - 2.4, mainDoor.at + 2.4, 0, 0.35, B.z - 1.6, B.z - 0.35, mStone, false);
  // a front veranda with pillars, or with a car porch, one pillar at the porch's open front corner (the roof covers it)
  const nP = Math.max(2, Math.round(B.w / 12) + 1);
  const pillars = innerPorch
    ? [[innerPorch.x + innerPorch.w / 2 < mainDoor.at ? innerPorch.x + 0.5 : innerPorch.x + innerPorch.w - 0.5, innerPorch.z + 0.5]]
    : Array.from({ length: nP }, (_, i) => [B.x + 0.9 + (i * (B.w - 1.8)) / (nP - 1), B.z - pd + 0.7]);
  for (const [px, pz] of pillars) {
    if (st.pillar === 'box') box(world, px - 0.35, px + 0.35, 0, 9.3, pz - 0.35, pz + 0.35, mTrim, true);
    else {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 9.3, 24), st.pillar === 'column' ? mTrim : mExt);
      cyl.position.set(px, 4.65, pz); cyl.castShadow = cyl.receiveShadow = true; world.add(cyl);
      colliders.push({ x0: px - 0.5, x1: px + 0.5, z0: pz - 0.5, z1: pz + 0.5 });
      box(world, px - 0.8, px + 0.8, 8.9, 9.3, pz - 0.8, pz + 0.8, st.pillar === 'column' ? mTrim : mAccent);
      box(world, px - 0.8, px + 0.8, 0, 0.5, pz - 0.8, pz + 0.8, st.pillar === 'column' ? mTrim : mAccent);
    }
  }
  // paved walkway to the door
  plane(mainDoor.at - 2, mainDoor.at + 2, 0, B.z, 0.025, mPave);

  // car (parked in the car porch when the house has one), trees, shrubs
  if (rule.front >= 10 || (porch && porch.w >= 8)) {
    const carX = porch ? porch.x + porch.w / 2 : gateX > W / 2 ? Math.max(8, W * 0.25) : Math.min(W - 8, W * 0.75);
    const car = new THREE.Group();
    const paint = mat('#9a2f2f', { roughness: 0.25, metalness: 0.55, envMapIntensity: 1.2 }), black = mat('#1a1a1a', { roughness: 0.6 });
    const cb = (cx, cy, cz, w, h, d, m) => bx(car, cx, cy, cz, w, h, d, m);
    cb(0, 1.55, 0, 14, 1.6, 5.8, paint); cb(-0.6, 2.95, 0, 7.4, 1.25, 5.2, paint);
    cb(-0.6, 2.95, 0, 7.6, 1.0, 5.3, mGlass); cb(6.9, 1.4, 0, 0.3, 0.6, 5.0, mat('#e8e8e8', { emissive: '#666' })); cb(-6.9, 1.6, 0, 0.3, 0.5, 5.0, mat('#a01818', { emissive: '#400' }));
    cb(0, 0.9, 0, 14.2, 0.35, 5.9, black);
    [[-4.5, 2.8], [4.5, 2.8], [-4.5, -2.8], [4.5, -2.8]].forEach(([x, z]) => {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.8, 20), black);
      wh.rotation.x = Math.PI / 2; wh.position.set(x, 1.1, z); wh.castShadow = true; car.add(wh);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.85, 16), mat('#b9bfc4', { metalness: 0.7, roughness: 0.3 }));
      hub.rotation.x = Math.PI / 2; hub.position.set(x, 1.1, z); car.add(hub);
    });
    car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    if (porch) {                                                 // nose toward the house, back end toward the gate
      car.rotation.y = Math.PI / 2;
      car.position.set(carX, 0, porch.z + porch.d - 7.4);
      colliders.push({ x0: carX - 3, x1: carX + 3, z0: car.position.z - 7, z1: car.position.z + 7 });
    } else {
      car.position.set(carX, 0, Math.min(rule.front / 2 + 0.5, 6.5));
      colliders.push({ x0: carX - 7, x1: carX + 7, z0: car.position.z - 3, z1: car.position.z + 3 });
    }
    world.add(car);
  }
  const leafMats = ['#4d7d36', '#5c8a3e', '#41702f', '#6a9645'].map((c) => mat(c, { roughness: 0.95, flatShading: true }));
  const tree = (x, z, s = 1) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.38 * s, 5.5 * s, 9), mat('#5e4430', { roughness: 1 }));
    t.position.set(x, 2.75 * s, z); t.castShadow = true; world.add(t);
    for (let i = 0; i < 5; i++) {
      const r = (1.4 + rnd() * 1.1) * s;
      const l = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMats[i % leafMats.length]);
      l.position.set(x + (rnd() - 0.5) * 2.6 * s, (5.6 + rnd() * 2.2) * s, z + (rnd() - 0.5) * 2.6 * s);
      l.castShadow = true; world.add(l);
    }
    colliders.push({ x0: x - 0.4, x1: x + 0.4, z0: z - 0.4, z1: z + 0.4 });
  };
  const shrub = (x, z, s = 1) => { const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 * s, 1), leafMats[Math.floor(rnd() * 4)]); l.position.set(x, 0.7 * s, z); l.scale.y = 0.75; l.castShadow = true; world.add(l); };
  tree(1.5, 1.8); tree(W - 1.5, 1.8);
  if (rule.rear >= 4) tree(W / 2, D - 1.6, 0.9);
  tree(-6, -3, 1.2); tree(W + 6, -3, 1.2);
  for (let x = 1.2; x < W - 1; x += 2.2) if ((x < gateLo - 1.5 || x > gateHi + 1.5) && B.z > 3.5 && !(porch && x > porch.x - 1 && x < porch.x + porch.w + 1)) shrub(x, 1.1, 0.8);
  // street lamps
  for (const lx of [-18, W + 18]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 16, 10), mat('#3a3f44', { metalness: 0.5, roughness: 0.5 }));
    pole.position.set(lx, 8, -6); pole.castShadow = true; world.add(pole);
    box(world, lx - 0.3, lx + 0.3, 15.6, 16, -9, -6, mat('#3a3f44'));
    box(world, lx - 0.4, lx + 0.4, 15.4, 15.6, -9, -8, mat('#fff7dd', { emissive: '#fff0c0', emissiveIntensity: 0.6 }));
  }
  // neighbours on either side, plain and pale so they frame the house without competing with it
  if (context) {
    const nm = mat('#d8d4cb', { roughness: 0.95 });
    box(world, -42, -1.2, 0, 21, 8, D - 6, nm); box(world, -42, -1.2, 21, 21.4, 8, D - 6, mat('#c9c4b9'));
    box(world, W + 1.2, W + 42, 0, 11, 14, D - 8, nm); box(world, W + 1.2, W + 42, 11, 11.4, 14, D - 8, mat('#c9c4b9'));
  }

  // upstairs, the stairwell is an open shaft: a landing 3.5 ft deep beside the door stays walkable, the rest is railed off
  let landing = null;
  if (upStairs) {
    const sr = upStairs, LAND = 3.5;
    const dr = (U.openings || []).find((o) => o.kind === 'door' && (o.room === sr.id || o.to === sr.id));
    let side = 'S';                                                // S = far end (larger z), N = road end, W / E = left / right
    if (dr) side = dr.o === 'h' ? (Math.abs(dr.c - sr.z) < 0.05 ? 'N' : 'S') : (Math.abs(dr.c - sr.x) < 0.05 ? 'W' : 'E');
    const lz = side === 'N' ? [sr.z, sr.z + Math.min(LAND, sr.d)] : side === 'S' ? [sr.z + sr.d - Math.min(LAND, sr.d), sr.z + sr.d] : [sr.z, sr.z + sr.d];
    const lx = side === 'W' ? [sr.x, sr.x + Math.min(LAND, sr.w)] : side === 'E' ? [sr.x + sr.w - Math.min(LAND, sr.w), sr.x + sr.w] : [sr.x, sr.x + sr.w];
    landing = { x: (lx[0] + lx[1]) / 2, z: (lz[0] + lz[1]) / 2 };
    const rail = (x0, x1, z0, z1) => {
      if (x1 - x0 < 0.2 || z1 - z0 < 0.2) return;
      upperColliders.push({ x0, x1, z0, z1 });
      box(world, x0, x1, STOREY + 2.9, STOREY + 3.1, z0, z1, mFrame);                       // a handrail on slim balusters
      const len = Math.max(x1 - x0, z1 - z0), alongX = x1 - x0 > z1 - z0;
      for (let s = 0.3; s < len; s += 0.6) {
        if (alongX) box(world, x0 + s - 0.04, x0 + s + 0.04, STOREY, STOREY + 2.9, z0, z1, mFrame, false);
        else box(world, x0, x1, STOREY, STOREY + 2.9, z0 + s - 0.04, z0 + s + 0.04, mFrame, false);
      }
    };
    const t = 0.25;
    if (side === 'N' || side === 'S') rail(sr.x, sr.x + sr.w, side === 'N' ? lz[1] - t : lz[0], side === 'N' ? lz[1] : lz[0] + t);   // across the shaft at the landing's edge
    else rail(side === 'W' ? lx[1] - t : lx[0], side === 'W' ? lx[1] : lx[0] + t, sr.z, sr.z + sr.d);
  }

  const mats = { mExt, mInt, mTrim, mAccent };
  function setColors(c = {}) {
    if (c.wall) mExt.color.set(c.wall);
    if (c.interior) mInt.color.set(c.interior);
    if (c.trim) mTrim.color.set(c.trim);
    if (c.accent) mAccent.color.set(c.accent);
  }
  return { scene, sun, world, roofG, colliders, upperColliders, landing, stairsRoom, upStairs, gateX, open, porch, mats, setColors, furnReady, pieces: { ground: piecesG, upper: piecesU } };
}

function disposeScene(scene) {
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}

// ---------- a photo of the house from the street, for the design cards and the plan sheet ----------
let shotRenderer = null;
/** Renders the front of the house as an image (data URL). Same scene as the walkthrough, without furniture. */
export function renderFront(L, styleId, U = null, { colors = {}, width = 960, height = 620, view = 'street' } = {}) {
  if (!shotRenderer) {
    shotRenderer = prepareRenderer(new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    shotRenderer.setPixelRatio(1);
  }
  shotRenderer.setSize(width, height, false);
  const S = buildScene(shotRenderer, L, styleId, U, { colors, furniture: false, context: true });
  const { w: W } = L.plot, B = L.B;
  const topH = (U ? STOREY + H : H) + SLAB + 3;
  const cam = new THREE.PerspectiveCamera(30, width / height, 1, 2000);
  const vf = Math.tan(THREE.MathUtils.degToRad(15)), hf = vf * (width / height);
  const span = Math.max(W + 10, 1);
  const dist = Math.max((span / 2) / hf, (topH * 0.62) / vf) + 6;
  const tx = W / 2, tz = B.z;
  if (view === 'street') cam.position.set(tx + dist * 0.3, 8 + topH * 0.16, tz - dist);
  else cam.position.set(tx, topH * 0.5, tz - dist);                                       // straight-on elevation
  cam.lookAt(tx, topH * 0.42, tz);
  shotRenderer.render(S.scene, cam);
  const url = shotRenderer.domElement.toDataURL('image/jpeg', 0.9);
  disposeScene(S.scene);
  return url;
}

/** U: the first-floor layout of a two-storey house (built above the ground floor, stairs between). */
export function createViewer(host, L, styleId, hooks = {}, U = null, colors = {}) {
  const { w: W, d: D } = L.plot;
  const { B } = L;

  const renderer = prepareRenderer(new THREE.WebGLRenderer({ antialias: true }));
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';

  const S = buildScene(renderer, L, styleId, U, { colors, furniture: true });
  const { scene, roofG, colliders, upperColliders, landing, stairsRoom, upStairs, gateX, open, porch } = S;
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
  camera.rotation.order = 'YXZ';

  // room lights: a few lamps follow the visitor to the nearest rooms (many lights would slow every frame)
  const pool = Array.from({ length: 6 }, () => { const p = new THREE.PointLight('#ffe9c8', 30, 26, 2); scene.add(p); return p; });
  const placeLights = () => {
    const f = state.floor, here = f ? U : L;
    const rooms = here.rooms.filter((r) => !r.parent).map((r) => ({ r, d: Math.hypot(r.x + r.w / 2 - camera.position.x, r.z + r.d / 2 - camera.position.z) })).sort((a, b) => a.d - b.d);
    pool.forEach((p, i) => {
      const it = rooms[i];
      p.visible = !!it && state.mode === 'walk';
      if (it) p.position.set(it.r.x + it.r.w / 2, f * STOREY + 8.4, it.r.z + it.r.d / 2);
    });
  };

  // ---------- controls ----------
  const state = { mode: 'walk', yaw: Math.PI, pitch: 0, pos: new THREE.Vector3(gateX, EYE, 3), keys: new Set(), floor: 0 };
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enabled = false;
  orbit.target.set(W / 2, 0, D / 2);

  function setMode(mode) {
    state.mode = mode;
    orbit.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      camera.position.set(W / 2 + Math.max(W, D) * 0.35, Math.max(W, D) * 0.95, -D * 0.35);
      orbit.target.set(W / 2, 0, D / 2);
      orbit.update();
      roofG.visible = false;
    } else {
      roofG.visible = true;
    }
    placeLights();
    hooks.onMode?.(mode, roofG.visible);
  }
  function setRoof(v) { roofG.visible = v; }
  function resetWalk() { state.floor = 0; state.pos.set(gateX, EYE, 3); state.yaw = Math.PI; state.pitch = 0; hooks.onFloor?.(0); }
  /** Climb to the first floor (or come back down): the visitor stands at the foot or head of the stairs. */
  function setFloor(f) {
    if (!U || f === state.floor) return;
    const at = (f ? upStairs : stairsRoom) || stairsRoom;
    state.floor = f;
    state.pos.set(f && landing ? landing.x : at.x + at.w / 2, EYE + f * STOREY, f && landing ? landing.z : at.z + at.d / 2);
    if (state.mode === 'orbit') setMode('walk');
    placeLights();
    hooks.onFloor?.(f);
  }

  let drag = null;
  const el = renderer.domElement;
  const onDown = (e) => { if (state.mode === 'walk') { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture?.(e.pointerId); } };
  const onMove = (e) => {
    if (!drag || state.mode !== 'walk') return;
    state.yaw -= (e.clientX - drag.x) * 0.0045;
    state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch - (e.clientY - drag.y) * 0.0045));
    drag = { x: e.clientX, y: e.clientY };
  };
  const onUp = () => { drag = null; };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  const kd = (e) => { if (e.target.tagName === 'INPUT') return; state.keys.add(e.key.toLowerCase()); if (e.key.startsWith('Arrow')) e.preventDefault(); };
  const ku = (e) => state.keys.delete(e.key.toLowerCase());
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);

  const blocked = (x, z, r) => (state.floor ? upperColliders : colliders).some((c) => x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r);
  function roomAt(x, z) {
    const here = state.floor ? U : L;
    const hit = here.rooms.filter((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d);
    if (state.floor) {
      const terrace = (U.open || []).find((p) => x >= p.x && x <= p.x + p.w && z >= p.z && z <= p.z + p.d);
      return (hit.find((r) => r.parent) || hit[0])?.name || (terrace ? 'Terrace' : x >= B.x && x <= B.x + B.w && z >= B.z && z <= B.z + B.d ? 'Terrace' : 'Outside');
    }
    const space = open.find((p) => x >= p.x && x <= p.x + p.w && z >= p.z && z <= p.z + p.d);
    return (hit.find((r) => r.parent) || hit[0])?.name || space?.name || (z < 0 ? 'Road' : z < B.z ? (porch ? 'Lawn' : 'Porch & lawn') : 'Outside');
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let raf, last = performance.now(), lastRoom = '', lightT = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.mode === 'walk') {
      const k = state.keys;
      const run = k.has('shift') ? 2 : 1;
      const turn = ((k.has('arrowleft') || k.has('q')) ? 1 : 0) - ((k.has('arrowright') || k.has('e')) ? 1 : 0);
      state.yaw += turn * 1.8 * dt;
      const fwd = ((k.has('w') || k.has('arrowup')) ? 1 : 0) - ((k.has('s') || k.has('arrowdown')) ? 1 : 0);
      const str = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
      const sp = 7 * run * dt;
      const fx = -Math.sin(state.yaw), fz = -Math.cos(state.yaw), rx = Math.cos(state.yaw), rz = -Math.sin(state.yaw);
      const dx = (fx * fwd + rx * str) * sp, dz = (fz * fwd + rz * str) * sp;
      const R = 1.0;
      if (!blocked(state.pos.x + dx, state.pos.z, R)) state.pos.x += dx;
      if (!blocked(state.pos.x, state.pos.z + dz, R)) state.pos.z += dz;
      camera.position.copy(state.pos);
      camera.rotation.set(state.pitch, state.yaw, 0);
      const rn = roomAt(state.pos.x, state.pos.z);
      if (rn !== lastRoom) { lastRoom = rn; hooks.onRoom?.(rn); }
      if ((lightT += dt) > 0.3) { lightT = 0; placeLights(); }
    } else orbit.update();
    renderer.render(scene, camera);
  }
  setMode('walk');
  raf = requestAnimationFrame(loop);
  Promise.all(S.furnReady).then(() => hooks.onReady?.());

  return {
    setMode, setRoof, resetWalk, setFloor, setColors: S.setColors,
    get floor() { return state.floor; },
    get roofVisible() { return roofG.visible; },
    get mode() { return state.mode; },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('pointerup', onUp);
      orbit.dispose(); disposeScene(scene); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
