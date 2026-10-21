import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STYLES } from './styles.js';
import { furnish } from './furniture.js';
import { addFurniture, furnitureColliders } from './furn3d.js';
import { loadCar, CARS } from './car3d.js';
import { turningStair, stairPlan } from './layout.js';

const H = 10; // wall height (ft)
const EYE = 5.4;
const SLAB = 0.6, STOREY = H + SLAB;                                // thickness of the floor slab, floor-to-floor height

// ---------- procedural textures (drawn once, shared) ----------
const texCache = new Map();
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function makeTex(kind, tint = null) {
  const key = tint ? `${kind}:${tint}` : kind;                    // tint: the base colour, for tiles that follow the style
  if (texCache.has(key)) return texCache.get(key);
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
    const base = tint || { marble: '#ecE9e2', 'marble-warm': '#e8dcc4', terracotta: '#c9774c', tile: '#cfe0e6', roofTile: '#b0532f' }[kind] || '#ddd';
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
  texCache.set(key, t);
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
export const SITE_DEFAULT = { wall: 'plain', wallH: 4.5, wallColor: null, gate: 'slide', car: 'ferrari', carColor: 'red', floorLiving: null, floorBed: null,
  roof: 'flat', windows: 'standard', shutters: false, cladding: 'none' };          // the last four are facade options (render only)
export function buildScene(renderer, L, styleId, U = null, { colors = {}, furniture = true, context = false, site = {} } = {}) {
  site = { ...SITE_DEFAULT, ...site };
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
  const mBrick = texMat('brick', { roughness: 0.9 }, 4);
  const mDoorOpen = new Set();
  const world = new THREE.Group(); scene.add(world);
  const roofG = new THREE.Group(); world.add(roofG);
  const colliders = [], upperColliders = [];
  const furnReady = [];                                            // furniture models arrive after the walls: the house is usable at once
  const doorList = [], storeyG = [], floorMeshes = [];             // swing doors, the group of each storey, floors (for live colour changes)
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
  const cw = 0.5, ch = site.wallH;
  const wallMat = site.wallColor ? texMat('plaster', { color: site.wallColor, roughness: 0.95 }, 9) : mExt;
  const cwall = (x0, x1, z0, z1) => {
    if (site.wall === 'none') return;
    const along = x1 - x0 > z1 - z0;
    if (site.wall === 'bars') {                                     // a low plastered base with iron railings above it
      const base = Math.min(2.2, ch * 0.42);
      box(world, x0, x1, 0, base, z0, z1, wallMat, true);
      box(world, x0 - 0.1, x1 + 0.1, base, base + 0.25, z0 - 0.1, z1 + 0.1, mTrim);
      box(world, x0, x1, ch - 0.15, ch, z0, z1, mGrill, false);
      box(world, x0, x1, base + 0.25, base + 0.4, z0, z1, mGrill, false);
      const len = along ? x1 - x0 : z1 - z0;
      for (let t = 0.3; t < len; t += 0.55) {
        if (along) box(world, x0 + t - 0.04, x0 + t + 0.04, base + 0.25, ch, z0 + 0.1, z1 - 0.1, mGrill, false);
        else box(world, x0 + 0.1, x1 - 0.1, base + 0.25, ch, z0 + t - 0.04, z0 + t + 0.04, mGrill, false);
      }
      return;
    }
    const m = site.wall === 'brick' ? mBrick : wallMat;
    box(world, x0, x1, 0, ch, z0, z1, m, true);
    box(world, x0 - 0.12, x1 + 0.12, ch, ch + 0.3, z0 - 0.12, z1 + 0.12, mTrim);
    if (site.wall !== 'brick') box(world, x0 - 0.04, x1 + 0.04, 0, 1, z0 - 0.04, z1 + 0.04, mStone, false);
  };
  cwall(0, gateLo, -cw / 2, cw / 2);
  cwall(gateHi, W, -cw / 2, cw / 2);
  cwall(0, W, D - cw / 2, D + cw / 2);
  if (rule.side > 0) { cwall(-cw / 2, cw / 2, 0, D); cwall(W - cw / 2, W + cw / 2, 0, D); }
  if (site.wall !== 'none') [gateLo - 0.4, gateHi + 0.4].forEach((x) => { box(world, x - 0.7, x + 0.7, 0, Math.max(6, ch + 1.5), -0.75, 0.75, mStone, true); box(world, x - 0.85, x + 0.85, Math.max(6, ch + 1.5), Math.max(6, ch + 1.5) + 0.4, -0.9, 0.9, mTrim); });
  if (site.wall !== 'none') {                                       // the gate: a sliding leaf parked beside the gateway, or two swing leaves; it opens and closes like the doors
    const gw = gateHi - gateLo, gh = Math.max(5.3, ch + 0.8);
    const leaf = (parent, g0, g1, z0, z1) => {
      box(parent, g0, g1, 0.2, 0.45, z0, z1, mGrill); box(parent, g0, g1, gh - 0.3, gh, z0, z1, mGrill);
      for (let x = g0 + 0.25; x < g1; x += 0.45) box(parent, x - 0.04, x + 0.04, 0.2, gh, z0 + 0.03, z1 - 0.03, mGrill, false);
    };
    const gateDoor = (d) => {
      Object.assign(d, { t: 1, target: 1, upper: false, dy: 0, name: 'Main gate', main: false, z: 0.4 });
      d.col.door = d; d.col.k = 'door';
      (d.kind === 'swing' ? d.mesh : d.slide).traverse((q) => { q.userData.door = d; });
      colliders.push(d.col); doorList.push(d);
    };
    if (site.gate === 'swing') {                                    // two leaves hinged on the pillars, swinging in towards the house
      [[gateLo, 1, -Math.PI / 2], [gateHi, -1, Math.PI / 2]].forEach(([hx, dir, open], i) => {
        const pivot = new THREE.Group(); pivot.position.set(hx, 0, 0.4); world.add(pivot);
        const mesh = new THREE.Group(); pivot.add(mesh);
        const x0 = dir > 0 ? 0.05 : -gw / 2 + 0.1, x1 = dir > 0 ? gw / 2 - 0.1 : -0.05;
        leaf(mesh, x0, x1, -0.08, 0.08);
        pivot.rotation.y = open;
        gateDoor({ kind: 'swing', pivot, open, mesh, x: hx + dir * gw / 4, col: { x0: Math.min(hx, hx + dir * (gw / 2 - 0.1)), x1: Math.max(hx, hx + dir * (gw / 2 - 0.1)), z0: 0.1, z1: 0.7 } });
      });
    } else {
      const right = gateHi + gw <= W - 0.4, g0 = right ? gateHi + 0.3 : gateLo - gw - 0.3;
      const slide = new THREE.Group(); world.add(slide);
      leaf(slide, gateLo, gateHi, 0.35, 0.5);                       // drawn across the gateway; slid aside when open
      const travel = g0 - gateLo;
      slide.position.x = travel;
      gateDoor({ kind: 'slide', slide, axis: 'x', travel, open: 1, x: gateX, col: { x0: gateLo, x1: gateHi, z0: 0.1, z1: 0.75 } });
    }
  }

  // ---------- walls, floors, furniture: one storey (dy = height of its floor) ----------
  function buildStorey(L, dy, upper) {
    const { B } = L;
    const open = L.open || [];
    const walls = new THREE.Group(); walls.position.y = dy; world.add(walls); storeyG.push(walls);
    curColl = upper ? upperColliders : colliders;
    const OPS = L.openings.map((p) => {
      if (p.kind !== 'window' || p.bath || site.windows === 'standard') return p;
      const room = p.span ? p.span[1] - p.span[0] : p.w + 2;
      if (site.windows === 'tall') return { ...p, sill: 0.7, top: 7.8, w: Math.min(p.w, Math.max(2.5, room - 1)) };
      if (site.windows === 'wide') return { ...p, w: Math.min(p.w * 1.4, Math.max(p.w, room - 1.2)), sill: 3.4, top: 6.7 };
      return p;
    });
    const plinthH = site.cladding === 'stone' ? 3.8 : 1.4;
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
      const frontWall = o === 'h' && eq(c, B.z) && !upper;
      const outerMat = frontWall && site.cladding === 'brick' ? mBrick : frontWall && site.cladding === 'slats' ? mSlats : mExt;
      const piece = (s0, s1, y0, y1, collide) => {
        if (s1 - s0 < 0.01) return;
        if (o === 'h') {
          box(walls, s0, s1, y0, y1, c - t / 2, c + t / 2, outer ? outerMat : mInt, collide);
          if (outer) box(walls, s0, s1, y0, y1, inDir > 0 ? c + t / 2 : c - t / 2 - 0.04, inDir > 0 ? c + t / 2 + 0.04 : c - t / 2, mInt, false, false);
          if (outer && !upper && y0 === 0) box(walls, s0, s1, 0, Math.min(plinthH, y1), inDir > 0 ? outFace - 0.07 : outFace, inDir > 0 ? outFace : outFace + 0.07, mStone, false, false);
        } else {
          box(walls, c - t / 2, c + t / 2, y0, y1, s0, s1, outer ? mExt : mInt, collide);
          if (outer) box(walls, inDir > 0 ? c + t / 2 : c - t / 2 - 0.04, inDir > 0 ? c + t / 2 + 0.04 : c - t / 2, y0, y1, s0, s1, mInt, false, false);
          if (outer && !upper && y0 === 0) box(walls, inDir > 0 ? outFace - 0.07 : outFace, inDir > 0 ? outFace : outFace + 0.07, 0, Math.min(plinthH, y1), s0, s1, mStone, false, false);
        }
      };
      const ops = OPS.filter((p) => p.o === o && eq(p.c, c) && p.at - p.w / 2 >= a - 0.02 && p.at + p.w / 2 <= b + 0.02).sort((p, q) => p.at - q.at);
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
          if (site.shutters && !p.bath) for (const sd of [-1, 1]) {                                         // wooden louvred shutters either side
            const a0 = sd < 0 ? o0 - 0.62 : o1 + 0.06, a1 = sd < 0 ? o0 - 0.06 : o1 + 0.62;
            along(a0, a1, p.sill, p.top, 0.05, mAccent, outSide * (t / 2 + 0.07));
            for (let y = p.sill + 0.25; y < p.top - 0.1; y += 0.3) along(a0 + 0.05, a1 - 0.05, y, y + 0.05, 0.08, mTrim, outSide * (t / 2 + 0.13));
          }
          if (!upper && !p.bath) for (let s = o0 + 0.35; s < o1 - 0.1; s += 0.5) along(s - 0.03, s + 0.03, p.sill, p.top, 0.03, mGrill, outSide * (t / 2 + 0.12));   // security grill
          if (!upper && !p.bath) along(o0, o1, p.sill + (p.top - p.sill) / 2 - 0.03, p.sill + (p.top - p.sill) / 2 + 0.03, 0.03, mGrill, outSide * (t / 2 + 0.12));
        }
      } else if (p.kind === 'door' && p.terrace) {
        // a sliding glass door onto the terrace: a fixed pane and a pane that slides over it
        along(o0 - fw, o1 + fw, p.top, p.top + fw, 0.3, mFrame);
        along(o0 - fw, o0, 0, p.top, 0.3, mFrame); along(o1, o1 + fw, 0, p.top, 0.3, mFrame);
        along(o0, o1, 0, 0.12, 0.3, mFrame);
        const half = (p.w - 0.1) / 2, slide = new THREE.Group();
        const pane = (grp, a0, a1) => { const frame = o === 'h' ? [a1 - a0, p.top - 0.25, 0.08] : [0.08, p.top - 0.25, a1 - a0]; const g = new THREE.Mesh(new THREE.BoxGeometry(...frame), mGlass); g.position.set(o === 'h' ? (a0 + a1) / 2 : 0, (p.top - 0.25) / 2 + 0.12, o === 'h' ? 0 : (a0 + a1) / 2); grp.add(g);
          const bar = (lo2, hi2, y0, y1) => { const q = o === 'h' ? new THREE.Mesh(new THREE.BoxGeometry(hi2 - lo2, y1 - y0, 0.14), mFrame) : new THREE.Mesh(new THREE.BoxGeometry(0.14, y1 - y0, hi2 - lo2), mFrame); q.position.set(o === 'h' ? (lo2 + hi2) / 2 : 0, (y0 + y1) / 2, o === 'h' ? 0 : (lo2 + hi2) / 2); grp.add(q); };
          bar(a0, a1, 0.1, 0.25); bar(a0, a1, p.top - 0.2, p.top); bar(a0, a0 + 0.12, 0.1, p.top); bar(a1 - 0.12, a1, 0.1, p.top); };
        const fixed = new THREE.Group(); walls.add(fixed);
        if (o === 'h') { fixed.position.set(0, 0, c - 0.1); slide.position.set(0, 0, c + 0.1); } else { fixed.position.set(c - 0.1, 0, 0); slide.position.set(c + 0.1, 0, 0); }
        pane(fixed, o0, o0 + half + 0.05); pane(slide, o0 + half - 0.05, o1);
        walls.add(slide);
        const col = o === 'h' ? { x0: o0, x1: o1, z0: c - 0.25, z1: c + 0.25 } : { x0: c - 0.25, x1: c + 0.25, z0: o0, z1: o1 };
        const door = { kind: 'slide', slide, axis: o === 'h' ? 'x' : 'z', travel: -(half - 0.1), t: 1, target: 1, open: 1, upper, dy, name: 'Terrace door', x: o === 'h' ? p.at : c, z: o === 'h' ? c : p.at, main: false, col: { ...col, door: null, k: 'door' } };
        door.col.door = door;
        slide.userData.door = door; slide.traverse((q) => { q.userData.door = door; });
        slide.position[door.axis] = door.travel;
        doorList.push(door);
        curColl.push(door.col);
      } else if (p.kind === 'door') {
        along(o0 - fw, o1 + fw, p.top, p.top + fw, 0.3, mFrame);
        along(o0 - fw, o0, 0, p.top, 0.3, mFrame);
        along(o1, o1 + fw, 0, p.top, 0.3, mFrame);
        // the leaf: hinged at the doorway, it swings into the room it belongs to (click it, or press F, to open and close)
        const into = outer ? inDir : sideOf(p.room, o, c);
        const leafLen = p.w - 0.1, th = 0.15, hgt = p.top - 0.08;
        const m = p.main ? (st.id === 'modern' ? mSlats : mDoor) : p.room?.startsWith('bath') ? mat('#e9e6df', { roughness: 0.5 }) : mDoor;
        const pivot = new THREE.Group();
        if (o === 'h') pivot.position.set(o0 + 0.04, 0.04, c); else pivot.position.set(c, 0.04, o0 + 0.04);
        const leafMesh = new THREE.Mesh(o === 'h' ? new THREE.BoxGeometry(leafLen, hgt, th) : new THREE.BoxGeometry(th, hgt, leafLen), m);
        if (o === 'h') leafMesh.position.set(leafLen / 2, hgt / 2, 0); else leafMesh.position.set(0, hgt / 2, leafLen / 2);
        leafMesh.castShadow = leafMesh.receiveShadow = true;
        const knob = (side) => { const kb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mGrill); if (o === 'h') kb.position.set(leafLen - 0.25, 3.1, side * (th / 2 + 0.08)); else kb.position.set(side * (th / 2 + 0.08), 3.1, leafLen - 0.25); leafMesh.add(kb); };
        knob(1); knob(-1);
        pivot.add(leafMesh);
        walls.add(pivot);
        const open = o === 'h' ? (into > 0 ? -Math.PI / 2 : Math.PI / 2) : (into > 0 ? Math.PI / 2 : -Math.PI / 2);
        const col = o === 'h' ? { x0: o0, x1: o1, z0: c - 0.2, z1: c + 0.2 } : { x0: c - 0.2, x1: c + 0.2, z0: o0, z1: o1 };
        const door = { kind: 'swing', pivot, open, t: 1, target: 1, upper, dy, mesh: leafMesh, name: p.room, x: o === 'h' ? p.at : c, z: o === 'h' ? c : p.at, main: !!p.main, col: { ...col, door: null, k: 'door' } };
        door.col.door = door;
        pivot.rotation.y = open;
        leafMesh.userData.door = door;
        doorList.push(door);
        curColl.push(door.col);
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
    const floorKind = (r) => (r.type.endsWith('bath') || r.type === 'kitchen' ? 'tile' : r.type === 'bed' ? (site.floorBed || st.floorBed) : (site.floorLiving || st.floorLiving));
    const order = [...L.rooms.filter((r) => !r.parent), ...L.rooms.filter((r) => r.parent)];
    order.forEach((r) => {
      if (upper && r.type === 'stairs') return;                    // the stairwell: open down to the stairs below
      const k = floorKind(r);
      const fl = plane(r.x, r.x + r.w, r.z, r.z + r.d, r.parent ? 0.05 : 0.03, fm[k] ||= floorMat(k), walls);
      if (!r.type.endsWith('bath') && r.type !== 'kitchen') { fl.userData.floorFor = r.type === 'bed' ? 'bed' : 'living'; floorMeshes.push({ mesh: fl, w: r.w, d: r.d }); }
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
  const midG = new THREE.Group(); world.add(midG);                    // the floor slab between the storeys
  const stairsG = new THREE.Group(); world.add(stairsG);              // the flight and its handrail
  const stairsRoom = L.rooms.find((r) => r.type === 'stairs');
  const upStairs = U && U.rooms.find((r) => r.type === 'stairs');

  // ---------- the stair-head room (mumty): at least 10 x 14 ft, over the stairs and grown towards the middle of the roof ----------
  const MUM = { short: 10, long: 14 };
  const mumtyBox = (sr, RB) => {
    if (!sr || site.roof === 'hip') return null;
    const alongX = sr.w >= sr.d, m = 1.4, cx = RB.x + RB.w / 2, cz = RB.z + RB.d / 2;
    const grow = (lo, hi, want, c, l0, l1) => {                    // widen [lo, hi] to `want`, towards c, inside [l0, l1]
      let need = want - (hi - lo);
      if (need <= 0) return [lo, hi];
      const up = c >= (lo + hi) / 2;
      const take = (room) => { const g = Math.max(0, Math.min(need, room)); need -= g; return g; };
      if (up) { hi += take(l1 - hi); lo -= take(lo - l0); } else { lo -= take(lo - l0); hi += take(l1 - hi); }
      return [lo, hi];
    };
    const [x0, x1] = grow(sr.x, sr.x + sr.w, alongX ? MUM.long : MUM.short, cx, RB.x + m, RB.x + RB.w - m);
    const [z0, z1] = grow(sr.z, sr.z + sr.d, alongX ? MUM.short : MUM.long, cz, RB.z + m, RB.z + RB.d - m);
    return { x0, x1, z0, z1, rb: RB, sr };
  };
  const mum = mumtyBox(U ? upStairs : stairsRoom, U ? U.B : B);

  // ---------- roof ----------
  // slab over a storey (with a stairwell hole when the storey above reaches it), a parapet round it, a cornice, a water tank
  const ov = 0.45;
  const pm = st.id === 'spanish' ? mExt : st.id === 'modern' ? mTrim : mExt;
  // cover: rooms of the storey above; the parapet runs only where the roof edge is open (the terrace), not under its walls
  const hipRoof = (parent, bx0, bx1, bz0, bz1, y, rise) => {         // a four-sided roof, the ridge along the longer side
    const w = bx1 - bx0, dd = bz1 - bz0, along = w >= dd, inset = Math.min(w, dd) / 2 - 0.01, xc = (bx0 + bx1) / 2, zc = (bz0 + bz1) / 2;
    const A = [bx0, y, bz0], Bv = [bx1, y, bz0], C = [bx1, y, bz1], Dv = [bx0, y, bz1];
    const r1 = along ? [bx0 + inset, y + rise, zc] : [xc, y + rise, bz0 + inset], r2 = along ? [bx1 - inset, y + rise, zc] : [xc, y + rise, bz1 - inset];
    const faces = along ? [[A, Bv, r2, r1], [C, Dv, r1, r2], [Dv, A, r1], [Bv, C, r2]] : [[Dv, A, r1, r2], [Bv, C, r2, r1], [A, Bv, r1], [C, Dv, r2]];
    const pos = [], uvs = [];
    const vert = (v) => { pos.push(...v); uvs.push((v[0] + v[2]) / 5, v[1] / 3); };
    for (const f of faces) {
      if (f.length === 4) { for (const k of [0, 1, 2, 0, 2, 3]) vert(f[k]); } else for (const v of f) vert(v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: makeTex('roofTile', st.tile || null), roughness: 0.8, side: THREE.DoubleSide }));
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    box(parent, bx0 - 0.1, bx1 + 0.1, y - 0.1, y + 0.1, bz0 - 0.1, bz1 + 0.1, mTrim, false);          // the eave board
  };
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
    if (top && site.roof === 'hip') {                                                            // a sloped tiled roof over the walls, with eaves, instead of the parapet
      hipRoof(parent, B.x - 1.6, B.x + B.w + 1.6, B.z - 1.6, B.z + B.d + 1.6, y + SLAB, Math.min(B.w, B.d) * 0.27 + 1.2);
      return;
    }
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
      box(parent, cx0, cx1, y - 0.7, y, cz0, cz0 + ct, mTrim); box(parent, cx0, cx1, y - 0.7, y, cz1 - ct, cz1, mTrim);
      box(parent, cx0, cx0 + ct, y - 0.7, y, cz0, cz1, mTrim); box(parent, cx1 - ct, cx1, y - 0.7, y, cz0, cz1, mTrim);
    }
    if (top) {
      if (!mum) {                                                   // no stair-head room: the tank stands on the roof itself
        box(parent, B.x + B.w - 5, B.x + B.w - 2, y + SLAB, y + SLAB + 2.8, B.z + B.d - 4, B.z + B.d - 1.5, mat('#2f3f4a', { roughness: 0.5 }));
        box(parent, B.x + B.w - 5.3, B.x + B.w - 1.7, y + SLAB + 2.8, y + SLAB + 3.0, B.z + B.d - 4.3, B.z + B.d - 1.2, mat('#3b4d59'));
      }
      for (let i = 0; i < 2; i++) {                                 // AC units along the back parapet, clear of the stair-head room
        const ax0 = B.x + 2 + i * 3.5, ax1 = ax0 + 2.6, az0 = B.z + B.d - 2.6, az1 = B.z + B.d - 1.4;
        if (mum && ax1 > mum.x0 - 0.8 && ax0 < mum.x1 + 0.8 && az1 > mum.z0 - 0.8 && az0 < mum.z1 + 0.8) continue;
        box(parent, ax0, ax1, y + SLAB, y + SLAB + 1.9, az0, az1, mat('#d9dcdc', { roughness: 0.5, metalness: 0.2 }));
      }
    }
  };
  if (!U) roofOf(B, H, roofG, 2.6, null, true);
  else {
    roofOf(B, H, midG, 3, stairsRoom, false, U.rooms.filter((r) => !r.parent));   // the ground floor's roof is the upstairs floor, and its open part the terrace
    roofOf(U.B, STOREY + H, roofG, 2.6, upStairs && site.roof !== 'hip' ? upStairs : null, true);      // the stairs go on up through the roof slab
    // a guard wall round the terrace edge keeps walkers on the slab
    upperColliders.push({ x0: B.x - 2, x1: B.x - 0.4, z0: B.z - 2, z1: B.z + B.d + 2 }, { x0: B.x + B.w + 0.4, x1: B.x + B.w + 2, z0: B.z - 2, z1: B.z + B.d + 2 },
      { x0: B.x - 2, x1: B.x + B.w + 2, z0: B.z - 2, z1: B.z - 0.4 }, { x0: B.x - 2, x1: B.x + B.w + 2, z0: B.z + B.d + 0.4, z1: B.z + B.d + 2 });
    // a handrail round the terrace edge keeps walkers on the slab
  }

  // ---------- the stairs ----------
  // A straight flight along the stairs room's longer side. It starts beside the ground-floor door and ends beside the
  // first-floor door (a flat landing the width of each door, or none when the door is in the end wall), so a visitor
  // walking in at one door steps out of the other at exactly the floor's height.
  let stairs = null;
  if (U && stairsRoom && upStairs) {
    const sr = stairsRoom, alongX = sr.w > sr.d, len = alongX ? sr.w : sr.d, wid = alongX ? sr.d : sr.w, lo = alongX ? sr.x : sr.z;
    const doorOf = (lay, rm) => lay.openings.find((o) => o.kind === 'door' && (o.room === rm.id || o.to === rm.id));
    const spanOf = (d) => {
      if (!d) return null;
      const longWall = alongX ? d.o === 'h' : d.o === 'v';
      if (longWall) return [Math.max(0, d.at - d.w / 2 - lo), Math.min(len, d.at + d.w / 2 - lo)];
      return Math.abs(d.c - lo) < 0.3 ? [0, 0] : [len, len];
    };
    const gd = doorOf(L, sr), ud = doorOf(U, upStairs);
    const gS = spanOf(gd) || [0, 0], uS = spanOf(ud) || [len, len];
    // a turning stair (two flights side by side, a landing at the far end) when the room is wide enough and both doors are at the same end
    const doorMid = (d, sp) => (d ? (sp[0] + sp[1]) / 2 : null), gm = doorMid(gd, gS), um = doorMid(ud, uS);
    const turned = (() => {
      if (!turningStair(sr) || gm == null || um == null || (gm < len / 2) !== (um < len / 2)) return null;
      const dir = gm < len / 2 ? 1 : -1, { u0, wf, ld, run } = stairPlan(sr);
      const n = Math.max(7, Math.min(9, Math.round(run / 0.6))), tr = run / n, half = STOREY / 2, stepH = half / n;
      const mStep = st.floorLiving.startsWith('marble') ? texMat(st.floorLiving, { roughness: 0.35 }, 4) : mTrim;
      const lowX = alongX ? sr.x : sr.z, lowAcross = alongX ? sr.z : sr.x;
      const bx = (ua, ub, va, vb, y0, y1, m, solid = false) => {            // a box from u (along, from the doors' end) and v (across, from the low side) ranges
        const a = dir > 0 ? [ua, ub] : [len - ub, len - ua];
        if (alongX) box(stairsG, sr.x + a[0], sr.x + a[1], y0, y1, sr.z + va, sr.z + vb, m, false);
        else box(stairsG, sr.x + va, sr.x + vb, y0, y1, sr.z + a[0], sr.z + a[1], m, false);
        return a;
      };
      for (let i = 0; i < n; i++) {
        bx(u0 + i * tr, u0 + (i + 1) * tr, 0.05, wf, 0, (i + 1) * stepH, mStep);                              // the way up, on the low side
        bx(len - ld - (i + 1) * tr, len - ld - i * tr, wid - wf, wid - 0.05, 0, half + (i + 1) * stepH, mStep);   // the way on, back over it on the other side
      }
      bx(len - ld, len, 0.05, wid - 0.05, half - 0.5, half, mStep);                                         // the half landing
      bx(0, u0, 0.05, wid - 0.05, STOREY - 0.5, STOREY, mStep);                                              // the floor at the doors' end, over the foot of the stair
      const wl = bx(u0, len - ld, wf, wid - wf, 0, STOREY, mExt);                                          // the wall between the flights
      const dv = alongX ? { x0: sr.x + wl[0], x1: sr.x + wl[1], z0: sr.z + wf, z1: sr.z + wid - wf } : { x0: sr.x + wf, x1: sr.x + wid - wf, z0: sr.z + wl[0], z1: sr.z + wl[1] };
      colliders.push({ ...dv, k: 'rail' }); upperColliders.push({ ...dv, k: 'rail' });
      // a handrail along each flight's outer wall
      const rail = (v, y0, y1, uA, uB) => {
        const A = alongX ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(0, 0, 0), at = (u, y) => { const o = dir > 0 ? u : len - u; return alongX ? new THREE.Vector3(sr.x + o, y, sr.z + v) : new THREE.Vector3(sr.x + v, y, sr.z + o); };
        void A;
        const p0 = at(uA, y0 + 3), p1 = at(uB, y1 + 3), vec = p1.clone().sub(p0);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(vec.length(), 0.14, 0.14), mFrame);
        bar.position.copy(p0.clone().add(p1).multiplyScalar(0.5)); bar.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), vec.clone().normalize()); bar.castShadow = true; stairsG.add(bar);
      };
      rail(0.28, 0, half, u0, len - ld); rail(wid - 0.28, STOREY, half, u0, len - ld);
      const pushU = (d) => {                                          // a spot just beyond a door, in the room on its other side
        if (!d) return { x: sr.x + sr.w / 2, z: sr.z + sr.d / 2 };
        const away = d.o === 'h' ? (sr.z + sr.d / 2 > d.c ? -1 : 1) : (sr.x + sr.w / 2 > d.c ? -1 : 1);
        return d.o === 'h' ? { x: d.at, z: d.c + away * 2.4 } : { x: d.c + away * 2.4, z: d.at };
      };
      void lowX; void lowAcross;
      const hxz = (x, z, floor) => {
        const a = alongX ? x - sr.x : z - sr.z, v = alongX ? z - sr.z : x - sr.x, u = dir > 0 ? a : len - a;
        if (u < u0) return floor * STOREY;
        if (u >= len - ld) return half;
        if (v <= wid / 2) return (Math.min(n - 1, Math.floor((u - u0) / tr)) + 1) * stepH;
        return half + (Math.min(n - 1, Math.floor((len - ld - u) / tr)) + 1) * stepH;
      };
      return { room: sr, alongX, lo, len, wid, dir, s0: u0, s1: len - ld, n: 2 * n, turn: true, wf, ld, u0, h: () => 0, hxz, entry: [pushU(gd), pushU(ud)] };
    })();
    if (turned) stairs = turned;
    else {
    const A = { dir: 1, s0: gS[1], s1: uS[0] }, Bk = { dir: -1, s0: len - gS[0], s1: len - uS[1] };
    let pick = A.s1 - A.s0 >= Bk.s1 - Bk.s0 ? A : Bk;
    let { dir, s0, s1 } = pick;
    s0 = Math.max(0, Math.min(s0, len - 3.5)); s1 = Math.max(s0 + 3.5, Math.min(s1, len));
    if (len < 4) { s0 = 0; s1 = len; }
    const n = 16, tr = (s1 - s0) / n;
    const hOf = (u) => {                                          // height of the walking surface at u (feet from the room's low end)
      const uu = dir > 0 ? u : len - u;
      if (uu <= s0) return 0;
      if (uu >= s1) return STOREY;
      return (Math.min(n - 1, Math.floor((uu - s0) / tr)) + 1) / n * STOREY;
    };
    const mStep = st.floorLiving.startsWith('marble') ? texMat(st.floorLiving, { roughness: 0.35 }, 4) : mTrim;
    const span = (u0, u1) => (dir > 0 ? [u0, u1] : [len - u1, len - u0]);
    const put = (u0, u1, y0, y1, m) => {
      const [a0, a1] = span(u0, u1);
      if (alongX) box(stairsG, sr.x + a0, sr.x + a1, y0, y1, sr.z + 0.05, sr.z + sr.d - 0.05, m, false);
      else box(stairsG, sr.x + 0.05, sr.x + sr.w - 0.05, y0, y1, sr.z + a0, sr.z + a1, m, false);
    };
    for (let i = 0; i < n; i++) put(s0 + i * tr, s0 + (i + 1) * tr, 0, ((i + 1) / n) * STOREY, mStep);
    if (s1 < len - 0.05) put(s1, len, STOREY - 0.5, STOREY, mStep);                    // the landing at the head of the flight
    // a handrail on the side wall, rising with the steps (balusters under it)
    const off = 0.28, fixed = alongX ? sr.z + off : sr.x + off, rise = STOREY, run = s1 - s0;
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    const at = (u, y) => { const [a0] = span(u, u); return alongX ? new THREE.Vector3(sr.x + a0, y, fixed) : new THREE.Vector3(fixed, y, sr.z + a0); };
    p0.copy(at(s0, 3.0)); p1.copy(at(s1, rise + 3.0));
    const vec = p1.clone().sub(p0), blen = vec.length();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(blen, 0.14, 0.14), mFrame);
    bar.position.copy(p0.clone().add(p1).multiplyScalar(0.5));
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), vec.clone().normalize());
    bar.castShadow = true; stairsG.add(bar);
    for (let i = 0; i < n; i += 2) {
      const u = s0 + (i + 0.5) * tr, top = ((i + 1) / n) * STOREY, ph = 3.0 + (u - s0) / run * rise;
      const q = at(u, (top + ph) / 2);
      const bal = new THREE.Mesh(new THREE.BoxGeometry(0.07, ph - top, 0.07), mFrame); bal.position.copy(q); stairsG.add(bal);
    }
    const push = (lay, rm, d) => {                                // a spot just beyond a door, in the room on its other side
      if (!d) return { x: sr.x + sr.w / 2, z: sr.z + sr.d / 2 };
      const away = d.o === 'h' ? (sr.z + sr.d / 2 > d.c ? -1 : 1) : (sr.x + sr.w / 2 > d.c ? -1 : 1);
      return d.o === 'h' ? { x: d.at, z: d.c + away * 2.4 } : { x: d.c + away * 2.4, z: d.at };
    };
    stairs = { room: sr, alongX, lo, len, wid, dir, s0, s1, n, h: hOf, entry: [push(L, sr, gd), push(U, upStairs, ud)] };
    }
  }

  // ---------- the way up to the roof: the same stairs turn back and climb on to a stair-head room (mumty) on the roof ----------
  if (U && stairs && upStairs && site.roof !== 'hip') {
    const sr = upStairs, { alongX, len, dir, s0, s1 } = stairs, yR = STOREY + H + SLAB, rise = yR - STOREY, n2 = 16, tr = (s1 - s0) / n2;
    const mStep = st.floorLiving.startsWith('marble') ? texMat(st.floorLiving, { roughness: 0.35 }, 4) : mTrim;
    const span = (u0, u1) => (dir > 0 ? [u0, u1] : [len - u1, len - u0]);
    const lift = 0.55;                                              // the turn: the first step of the second flight sits one rise above the landing
    for (let i = 0; i < n2; i++) {                                  // the second flight runs back over the first, from the landing end to the far end
      const [a0, a1] = stairs.turn ? span(s0 + i * tr, s0 + (i + 1) * tr) : span(s1 - (i + 1) * tr, s1 - i * tr), top = STOREY + lift + ((i + 1) / n2) * (rise - lift);
      if (alongX) box(stairsG, sr.x + a0, sr.x + a1, top - 0.45, top, sr.z + 0.05, sr.z + sr.d - 0.05, mStep, false);
      else box(stairsG, sr.x + 0.05, sr.x + sr.w - 0.05, top - 0.45, top, sr.z + a0, sr.z + a1, mStep, false);
    }
  }
  if (mum) {                                                        // the room itself: walls, a door towards the middle of the roof, a slab on top, a small water tank over it
    const yR = (U ? STOREY : 0) + H + SLAB, t = 0.45, wh = 8, gh = 6.8;
    const rcx = mum.rb.x + mum.rb.w / 2, rcz = mum.rb.z + mum.rb.d / 2, fx = (mum.x0 + mum.x1) / 2, fz = (mum.z0 + mum.z1) / 2;
    const doorOnX = Math.abs(rcx - fx) > Math.abs(rcz - fz) + 2;     // the door goes on the long side unless the middle of the roof is clearly further along
    const dSign = doorOnX ? Math.sign(rcx - fx) || 1 : Math.sign(rcz - fz) || 1;
    const x0 = mum.x0 - t, x1 = mum.x1 + t, z0 = mum.z0 - t, z1 = mum.z1 + t, gw = 3.2;
    const wall = (a0, a1, b0, b1) => box(roofG, a0, a1, yR, yR + wh, b0, b1, mExt);
    const gapW = (lo, hi) => { const m = (lo + hi) / 2; return [m - gw / 2, m + gw / 2]; };
    if (doorOnX) {
      const [g0, g1] = gapW(mum.z0, mum.z1), xs = dSign > 0 ? [x1 - t, x1] : [x0, x0 + t];
      wall(x0, x1, z0, mum.z0); wall(x0, x1, mum.z1, z1);
      wall(dSign > 0 ? x0 : x0 + t, dSign > 0 ? x1 - t : x1, mum.z0, mum.z1);
      wall(xs[0], xs[1], mum.z0, g0); wall(xs[0], xs[1], g1, mum.z1); box(roofG, xs[0], xs[1], yR + gh, yR + wh, g0, g1, mExt);
      box(roofG, xs[0] - 0.1, xs[1] + 0.1, yR, yR + 0.06, g0, g1, mTrim, false);
    } else {
      const [g0, g1] = gapW(mum.x0, mum.x1), zs = dSign > 0 ? [z1 - t, z1] : [z0, z0 + t];
      wall(x0, mum.x0, z0, z1); wall(mum.x1, x1, z0, z1);
      wall(mum.x0, mum.x1, dSign > 0 ? z0 : z0 + t, dSign > 0 ? z1 - t : z1);
      wall(mum.x0, g0, zs[0], zs[1]); wall(g1, mum.x1, zs[0], zs[1]); box(roofG, g0, g1, yR + gh, yR + wh, zs[0], zs[1], mExt);
      box(roofG, g0, g1, yR, yR + 0.06, zs[0] - 0.1, zs[1] + 0.1, mTrim, false);
    }
    const yT = yR + wh + 0.4;
    box(roofG, x0 - 0.3, x1 + 0.3, yR + wh, yT, z0 - 0.3, z1 + 0.3, mConcrete);                    // the roof slab with its edge
    box(roofG, x0 - 0.35, x1 + 0.35, yT - 0.12, yT, z0 - 0.35, z1 + 0.35, mTrim, false);
    // a small round water tank on a plinth, on the mumty roof, towards the far end from the door
    const tankR = 1.5, tankH = 3.2, tx = doorOnX ? fx - dSign * Math.min(2.5, (mum.x1 - mum.x0) / 4) : fx, tz = doorOnX ? fz : fz - dSign * Math.min(2.5, (mum.z1 - mum.z0) / 4);
    const mTank = mat('#232a30', { roughness: 0.55 }), mLid = mat('#3a5566', { roughness: 0.45 });
    box(roofG, tx - tankR - 0.3, tx + tankR + 0.3, yT, yT + 0.45, tz - tankR - 0.3, tz + tankR + 0.3, mConcrete, false);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(tankR * 0.92, tankR, tankH, 28), mTank);
    body.position.set(tx, yT + 0.45 + tankH / 2, tz); body.castShadow = body.receiveShadow = true; roofG.add(body);
    for (const k of [0.33, 0.66]) {                                                                // the moulded rings of a plastic tank
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(tankR * (0.93 + 0.07 * k) + 0.05, tankR * (0.93 + 0.07 * k) + 0.05, 0.12, 28), mTank);
      ring.position.set(tx, yT + 0.45 + tankH * k, tz); roofG.add(ring);
    }
    const lid = new THREE.Mesh(new THREE.SphereGeometry(tankR * 0.92, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), mLid);
    lid.scale.y = 0.55; lid.position.set(tx, yT + 0.45 + tankH, tz); lid.castShadow = true; roofG.add(lid);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16), mLid);
    cap.position.set(tx, yT + 0.45 + tankH + 0.5, tz); roofG.add(cap);
  }

  // ---------- balcony of the first floor (an open space of type balcony in front of the box) ----------
  for (const bl of (U ? (U.open || []).filter((q) => q.type === 'balcony') : [])) {
    const bz0 = bl.z, bz1 = bl.z + bl.d, bx0 = bl.x, bx1 = bl.x + bl.w;
    box(world, bx0, bx1, STOREY - 0.6, STOREY, bz0, bz1 + 0.4, mConcrete);                       // the slab, reaching back into the wall
    box(world, bx0 - 0.1, bx1 + 0.1, STOREY - 0.75, STOREY - 0.55, bz0 - 0.1, bz0 + 0.1, mTrim);
    const rail = (ax0, ax1, az0, az1) => {                                                       // a handrail on slim balusters, solid to the walker
      box(world, ax0, ax1, STOREY + 3.0, STOREY + 3.15, az0, az1, mFrame);
      const lenR = Math.max(ax1 - ax0, az1 - az0), alongR = ax1 - ax0 > az1 - az0;
      for (let t2 = 0.15; t2 < lenR; t2 += 0.5) {
        if (alongR) box(world, ax0 + t2 - 0.03, ax0 + t2 + 0.03, STOREY, STOREY + 3.0, az0, az1, mFrame, false);
        else box(world, ax0, ax1, STOREY, STOREY + 3.0, az0 + t2 - 0.03, az0 + t2 + 0.03, mFrame, false);
      }
      upperColliders.push({ x0: ax0, x1: ax1 || ax0 + 0.15, z0: az0, z1: az1, k: 'rail' });
    };
    rail(bx0, bx1, bz0, bz0 + 0.15); rail(bx0, bx0 + 0.15, bz0, bz1); rail(bx1 - 0.15, bx1, bz0, bz1);
    box(world, bx0, bx1, STOREY, STOREY + 0.03, bz0, bz1, mat('#c9c4b9'), false, false);
  }

  // ---------- porch, portico and carport ----------
  const pd = Math.min(rule.front - 1, 7);
  const doorXc = mainDoor.o === 'h' ? mainDoor.at : mainDoor.c;
  const pilCol = st.pillar === 'column' ? mTrim : st.pillar === 'arch' ? mExt : mTrim;
  const pillar = (px, pz, ph) => {
    if (st.pillar === 'box') box(world, px - 0.35, px + 0.35, 0, ph, pz - 0.35, pz + 0.35, mTrim, true);
    else {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, ph, 24), pilCol);
      cyl.position.set(px, ph / 2, pz); cyl.castShadow = cyl.receiveShadow = true; world.add(cyl);
      colliders.push({ x0: px - 0.5, x1: px + 0.5, z0: pz - 0.5, z1: pz + 0.5, k: 'pillar' });
      box(world, px - 0.75, px + 0.75, ph - 0.4, ph, pz - 0.75, pz + 0.75, st.pillar === 'column' ? mTrim : mAccent);
      box(world, px - 0.75, px + 0.75, 0, 0.5, pz - 0.75, pz + 0.75, st.pillar === 'column' ? mTrim : mAccent);
    }
  };
  const slab = (x0, x1, z0, z1, y) => {                          // a flat roof with a fascia, tiled on the Mediterranean style
    box(world, x0, x1, y, y + 0.5, z0, z1, st.id === 'spanish' ? mRoofTile : mConcrete);
    box(world, x0 - 0.1, x1 + 0.1, y - 0.15, y + 0.65, z0 - 0.1, z0 + 0.15, mTrim);
  };
  const carportAtFront = porch && !innerPorch;
  if (carportAtFront) {                                          // the car porch has its own roof and slim pillars; the house front stays visible
    const z0 = porch.z, z1 = Math.min(porch.z + porch.d, B.z + 0.4);
    slab(porch.x, porch.x + porch.w, z0, z1, 9.3);
    pillar(porch.x + 0.6, z0 + 0.6, 9.3); pillar(porch.x + porch.w - 0.6, z0 + 0.6, 9.3);
    if (z1 - z0 > 14) { pillar(porch.x + 0.6, (z0 + z1) / 2, 9.3); pillar(porch.x + porch.w - 0.6, (z0 + z1) / 2, 9.3); }
  }
  const doorUnderCarport = carportAtFront && doorXc >= porch.x - 0.5 && doorXc <= porch.x + porch.w + 0.5;
  if (!innerPorch && !doorUnderCarport) {                         // a portico over the front door
    const pw = Math.max(7, mainDoor.w + 4.5), pdp = Math.min(Math.max(pd, 3), 5);
    const x0 = Math.max(B.x, doorXc - pw / 2), x1 = Math.min(B.x + B.w, doorXc + pw / 2);
    slab(x0, x1, B.z - pdp, B.z + 0.4, 9.3);
    pillar(x0 + 0.6, B.z - pdp + 0.6, 9.3); pillar(x1 - 0.6, B.z - pdp + 0.6, 9.3);
  }
  if (st.deco === 'wood') {                                      // timber cladding round the entrance
    const dx0 = mainDoor.at - mainDoor.w / 2 - 0.2, dx1 = mainDoor.at + mainDoor.w / 2 + 0.2;
    box(world, dx0 - 1.6, dx0, 0, H, B.z - 0.45, B.z - 0.2, mSlats);
    box(world, dx1, dx1 + 1.6, 0, H, B.z - 0.45, B.z - 0.2, mSlats);
    box(world, dx0, dx1, 7.4, H, B.z - 0.45, B.z - 0.2, mSlats);
  }
  // front elevation details: a belt course between the floors, corner pilasters, planters and lanterns at the door
  {
    const top = U ? STOREY + H : H, fz0 = B.z - 0.55, fz1 = B.z - 0.15, bandM = st.id === 'modern' ? mFrame : st.id === 'spanish' ? mAccent : mTrim;
    if (U) {                                                      // a band at the first-floor slab, across the front and round both sides
      box(world, B.x - 0.3, B.x + B.w + 0.3, STOREY - 1.05, STOREY - 0.5, fz0, fz1, bandM, false);
      box(world, B.x - 0.55, B.x - 0.15, STOREY - 1.05, STOREY - 0.5, B.z - 0.55, B.z + B.d + 0.3, bandM, false);
      box(world, B.x + B.w + 0.15, B.x + B.w + 0.55, STOREY - 1.05, STOREY - 0.5, B.z - 0.55, B.z + B.d + 0.3, bandM, false);
    }
    if (st.id === 'classic') {                                    // raised corner blocks (quoins) up the front corners
      for (let y = 0.2; y < top - 1; y += 1.7) for (const sd of [0, 1]) {
        const w = (Math.floor(y / 1.7) % 2 ? 1.1 : 0.8), x0 = sd ? B.x + B.w - w + 0.2 : B.x - 0.2;
        box(world, x0, x0 + w, y, y + 1.5, fz0 - 0.05, fz1, mTrim, false);
      }
    }
    if (st.id === 'spanish') {                                    // a tiled drip course under the roof edge
      box(world, B.x - 0.3, B.x + B.w + 0.3, top - 0.8, top - 0.45, B.z - 0.7, B.z - 0.15, mRoofTile, false);
    }
    const mPot = mat('#9a948a', { roughness: 0.8 });
    for (const sd of [-1, 1]) {                                   // planters either side of the entrance steps, unless the car porch or the house edge is there
      const px = mainDoor.at + sd * 3.6;
      if (px < B.x + 0.8 || px > B.x + B.w - 0.8 || (porch && px > porch.x - 0.8 && px < porch.x + porch.w + 0.8)) continue;
      box(world, px - 0.8, px + 0.8, 0, 1.3, B.z - 1.5, B.z - 0.65, mPot, false);
      const lf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), mat('#4d7d36', { roughness: 0.95, flatShading: true }));
      lf.position.set(px, 1.9, B.z - 1.08); lf.scale.y = 0.85; lf.castShadow = true; world.add(lf);
    }
    for (const sd of [-1, 1]) {                                   // a wall lantern each side of the door
      const lx = mainDoor.at + sd * (mainDoor.w / 2 + 0.9);
      box(world, lx - 0.18, lx + 0.18, 6.6, 7.4, B.z - 0.5, B.z - 0.2, mFrame, false);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: '#fff2c9', emissive: '#ffd98a', emissiveIntensity: 0.9 }));
      glow.position.set(lx, 7.0, B.z - 0.65); world.add(glow);
    }
  }
  // front steps up to the entrance
  box(world, mainDoor.at - 2.4, mainDoor.at + 2.4, 0, 0.35, B.z - 1.6, B.z - 0.35, mStone, false);
  if (innerPorch) pillar(innerPorch.x + innerPorch.w / 2 < doorXc ? innerPorch.x + 0.5 : innerPorch.x + innerPorch.w - 0.5, innerPorch.z + 0.5, 9.3);
  // paved walkway to the door
  plane(mainDoor.at - 2, mainDoor.at + 2, 0, B.z, 0.025, mPave);

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
    colliders.push({ x0: x - 0.4, x1: x + 0.4, z0: z - 0.4, z1: z + 0.4, k: 'tree' });
  };
  const shrub = (x, z, s = 1) => { const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 * s, 1), leafMats[Math.floor(rnd() * 4)]); l.position.set(x, 0.7 * s, z); l.scale.y = 0.75; l.castShadow = true; world.add(l); };
  tree(1.5, 1.8); tree(W - 1.5, 1.8);
  if (rule.rear >= 4) tree(W / 2, D - 1.6, 0.9);
  tree(-6, -3, 1.2); tree(W + 6, -3, 1.2);
  for (let x = 1.2; x < W - 1; x += 2.2) if ((x < gateLo - 1.5 || x > gateHi + 1.5) && B.z > 3.5 && !(porch && x > porch.x - 1 && x < porch.x + porch.w + 1)) shrub(x, 1.1, 0.8);
  // car: parked where it leaves the way from the gate to the front door open. Spots are tried in turn (in the porch
  // away from the door, in the porch's middle, along the front lawn) and a flood fill over the collision boxes checks
  // that a visitor can still walk from the gateway to a step inside the front door
  if (site.car !== 'none' && (rule.front >= 10 || (porch && porch.w >= 8))) {
    const RW = 0.42;
    const hitAt = (x, z, extra) => colliders.some((c) => x > c.x0 - RW && x < c.x1 + RW && z > c.z0 - RW && z < c.z1 + RW)
      || extra.some((c) => x > c.x0 - RW && x < c.x1 + RW && z > c.z0 - RW && z < c.z1 + RW);
    const doorReach = (extra) => {
      if (mainDoor.o !== 'h') return true;
      const G = 0.25, zt = mainDoor.c + 1, tx = mainDoor.at;
      let sx = null;
      for (let k = 0; k < 80 && sx === null; k++) for (const sg of [1, -1]) {
        const x = gateX + sg * k * 0.5;
        if (x > gateLo + RW && x < gateHi - RW && !hitAt(x, 2.5, extra)) { sx = x; break; }
      }
      if (sx === null) return false;
      const st = [[Math.round(sx / G), 10]], seen = new Set([st[0].join()]);
      while (st.length) {
        const [i, j] = st.pop();
        if (Math.abs(i * G - tx) < mainDoor.w / 2 && j * G >= zt) return true;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const p = i + a, q = j + b, X = p * G, Z = q * G, k = p + ',' + q;
          if (X < -1 || X > W + 1 || Z < 0.3 || Z > zt + 0.5 || seen.has(k) || hitAt(X, Z, extra)) continue;
          seen.add(k); st.push([p, q]);
        }
      }
      return false;
    };
    const doorX = mainDoor.o === 'h' ? mainDoor.at : mainDoor.c;
    const cands = [];
    if (porch) {
      const z = porch.z + porch.d - 7.2 - (porch.d >= 17 ? 3 : 1.2);
      cands.push({ x: doorX > porch.x + porch.w / 2 ? porch.x + 3.3 : porch.x + porch.w - 3.3, z, along: true }, { x: porch.x + porch.w / 2, z, along: true });
    }
    if (B.z >= 9.5) {                                              // across the front lawn, parallel to the road
      const z = Math.max(3.8, Math.min(B.z - 4.2, 6.5));
      for (const x of [W * 0.72, W * 0.28, W / 2]) cands.push({ x, z, along: false });
    }
    const boxOf = (c) => (c.along ? { x0: c.x - 3, x1: c.x + 3, z0: c.z - 7, z1: c.z + 7 } : { x0: c.x - 7, x1: c.x + 7, z0: c.z - 3, z1: c.z + 3 });
    const fits = (c) => { const b = boxOf(c); return b.x0 > 0.4 && b.x1 < W - 0.4 && (c.along || b.z0 > 0.4) && !colliders.some((o) => o.x0 < b.x1 && o.x1 > b.x0 && o.z0 < b.z1 && o.z1 > b.z0); };
    const open0 = doorReach([]);
    // one car per bay of the porch (a porch 10 ft wide holds 1 car, 18 ft 2, 26 ft 3), else one across the lawn
    const bays = porch ? (porch.w >= 25.5 ? 3 : porch.w >= 17.5 ? 2 : 1) : 1;
    const want = Math.max(1, Math.min(3, site.cars || 1));        // cars the visitor asked for; one per bay of the porch, the rest on the lawn
    const kind = site.car && CARS[site.car] ? site.car : 'ferrari';
    let placed = 0;
    const put = (pick) => {
      const carG = new THREE.Group();
      carG.rotation.y = pick.along ? Math.PI : -Math.PI / 2;       // along: nose toward the house, back toward the gate; else along the lawn
      carG.position.set(pick.x, 0, pick.z);
      world.add(carG);
      colliders.push({ ...boxOf(pick), k: 'car' });
      furnReady.push(loadCar(kind, site.carColor).then((m) => { if (m) carG.add(m); }));
      placed++;
    };
    if (porch && bays > 1 && want > 1) {
      const z = porch.z + porch.d - 7.2 - (porch.d >= 17 ? 3 : 1.2), n = Math.min(bays, want), slot = porch.w / bays;
      for (let i = 0; i < bays && placed < n; i++) {
        const c = { x: porch.x + slot * (i + 0.5), z, along: true };
        if (fits(c) && (!open0 || doorReach([boxOf(c)]))) put(c);
      }
    }
    while (placed < want) {                                         // the first car in the porch (or on the lawn), any more across the lawn
      const pick = cands.find((c) => fits(c) && (!open0 || doorReach([boxOf(c)])));
      if (!pick) break;
      put(pick);
    }
  }
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

  const mats = { mExt, mInt, mTrim, mAccent };
  const floorCache = {};
  function setFloors(f = {}) {                                      // living-room and bedroom floors, live
    for (const key of ['living', 'bed']) {
      const kind = f[key];
      if (!kind) continue;
      const m = (floorCache[kind] ||= texMat(kind, { roughness: kind.startsWith('marble') || kind === 'granite' ? 0.35 : 0.7 }, 4));
      for (const fm of floorMeshes) if (fm.mesh.userData.floorFor === key) {
        const t = m.map.clone(); t.needsUpdate = true; t.repeat.set(fm.w / 4, fm.d / 4);
        const m2 = m.clone(); m2.map = t; fm.mesh.material = m2;
      }
    }
  }
  function setColors(c = {}) {
    if (c.wall) mExt.color.set(c.wall);
    if (c.interior) mInt.color.set(c.interior);
    if (c.trim) mTrim.color.set(c.trim);
    if (c.accent) mAccent.color.set(c.accent);
  }
  return { scene, sun, world, roofG, midG, stairsG, storeyG, doors: doorList, colliders, upperColliders, stairs, stairsRoom, upStairs, gateX, gateLo, gateHi, open, porch, innerPorch, mats, setColors, setFloors, furnReady, site, pieces: { ground: piecesG, upper: piecesU } };
}

function disposeScene(scene) {
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}

// ---------- a photo of the house from the street, for the design cards and the plan sheet ----------
let shotRenderer = null;
/** Renders the front of the house as an image (data URL). Same scene as the walkthrough, without furniture. */
export function renderFront(L, styleId, U = null, { colors = {}, width = 960, height = 620, view = 'street', site = {} } = {}) {
  if (!shotRenderer) {
    shotRenderer = prepareRenderer(new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    shotRenderer.setPixelRatio(1);
  }
  shotRenderer.setSize(width, height, false);
  const S = buildScene(shotRenderer, L, styleId, U, { colors, furniture: false, context: true, site });
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

export { STOREY, H, EYE, SLAB, prepareRenderer as prepare, disposeScene };
