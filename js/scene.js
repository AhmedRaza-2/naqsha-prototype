import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STYLES } from './styles.js';

const H = 10; // wall height (ft)
const EYE = 5.4;

// ---------- procedural textures ----------
function makeTex(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const speckle = (n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * a})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); } };
  if (kind === 'wood' || kind === 'wood-dark') {
    const base = kind === 'wood' ? [196, 150, 100] : [140, 92, 56];
    for (let i = 0; i < 8; i++) {
      const v = (Math.random() - 0.5) * 26;
      g.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v})`;
      g.fillRect(i * 32, 0, 32, 256);
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(i * 32, 0, 1.5, 256);
      g.fillRect(i * 32, Math.random() * 256, 32, 1.5);
    }
  } else {
    const base = { marble: '#ecE9e2', 'marble-warm': '#e8dcc4', terracotta: '#c9774c', tile: '#cfe0e6' }[kind] || '#ddd';
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    speckle(260, 0.05);
    g.strokeStyle = kind === 'terracotta' ? 'rgba(90,40,20,.45)' : 'rgba(0,0,0,.22)';
    g.lineWidth = 2;
    const step = kind === 'tile' ? 64 : 128;
    for (let p = 0; p <= 256; p += step) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.moveTo(0, p); g.lineTo(256, p); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createViewer(host, L, styleId, hooks = {}) {
  const st = STYLES[styleId];
  const { w: W, d: D } = L.plot;
  const { B, rule } = L;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bfe0f5');
  scene.fog = new THREE.Fog('#d6ebf7', 150, 600);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
  camera.rotation.order = 'YXZ';

  scene.add(new THREE.HemisphereLight('#ffffff', '#8a8570', 2.1));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.8);
  sun.position.set(W * 0.3, 80, -40);
  scene.add(sun);

  const matCache = new Map();
  const mat = (color, opts = {}) => {
    const k = color + JSON.stringify(opts);
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color, ...opts }));
    return matCache.get(k);
  };
  const mExt = mat(st.wall), mInt = mat(st.interior), mTrim = mat(st.trim), mAccent = mat(st.accent);
  const mGlass = mat(st.glass, { transparent: true, opacity: 0.38 });
  const mFrame = mat(st.frame);
  const world = new THREE.Group(); scene.add(world);
  const walls = new THREE.Group(); world.add(walls);
  const roofG = new THREE.Group(); world.add(roofG);
  const colliders = [];

  const box = (parent, x0, x1, y0, y1, z0, z1, m, collide) => {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return null;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    parent.add(mesh);
    if (collide) colliders.push({ x0, x1, z0, z1 });
    return mesh;
  };
  const bx = (parent, cx, cy, cz, w, h, d, m) => box(parent, cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2, m);

  // ---------- ground ----------
  const plane = (x0, x1, z0, z1, y, m) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), m);
    p.rotation.x = -Math.PI / 2; p.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); world.add(p); return p;
  };
  plane(-400, 400, -400, 400, -0.05, mat('#8fb06a'));
  plane(-400, 400, -40, -8, -0.02, mat('#4d4f52'));
  plane(-400, 400, -8, 0, -0.01, mat('#a8a79f'));
  for (let x = -200; x < 200; x += 14) plane(x, x + 6, -24.4, -23.6, -0.015, mat('#e8e5d0'));
  plane(0, W, 0, D, 0, mat('#86b25f'));
  plane(0, W, 0, B.z, 0.01, mat('#b8b5ac'));

  // compound wall
  const mainDoor = L.openings.find((p) => p.main);
  const gateX = mainDoor.at, gateHalf = 4;
  const cw = 0.5, ch = 4.5;
  const cwall = (x0, x1, z0, z1) => box(world, x0, x1, 0, ch, z0, z1, mExt, true);
  cwall(0, gateX - gateHalf, -cw / 2, cw / 2);
  cwall(gateX + gateHalf, W, -cw / 2, cw / 2);
  cwall(0, W, D - cw / 2, D + cw / 2);
  if (rule.side > 0) { cwall(-cw / 2, cw / 2, 0, D); cwall(W - cw / 2, W + cw / 2, 0, D); }
  [gateX - gateHalf - 0.4, gateX + gateHalf + 0.4].forEach((x) => box(world, x - 0.6, x + 0.6, 0, 6, -0.7, 0.7, mTrim, true));

  // ---------- walls ----------
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

  const addLine = (o, line) => {
    const c = line.c;
    let outer = false, inDir = 1;
    if (o === 'h') { if (eq(c, B.z)) { outer = true; inDir = 1; } else if (eq(c, B.z + B.d)) { outer = true; inDir = -1; } }
    else { if (eq(c, B.x)) { outer = true; inDir = 1; } else if (eq(c, B.x + B.w)) { outer = true; inDir = -1; } }
    const t = outer ? 0.75 : 0.4;
    const piece = (s0, s1, y0, y1, collide) => {
      if (s1 - s0 < 0.01) return;
      if (o === 'h') {
        box(walls, s0, s1, y0, y1, c - t / 2, c + t / 2, outer ? mExt : mInt, collide);
        if (outer) box(walls, s0, s1, y0, y1, inDir > 0 ? c + t / 2 : c - t / 2 - 0.04, inDir > 0 ? c + t / 2 + 0.04 : c - t / 2, mInt);
      } else {
        box(walls, c - t / 2, c + t / 2, y0, y1, s0, s1, outer ? mExt : mInt, collide);
        if (outer) box(walls, inDir > 0 ? c + t / 2 : c - t / 2 - 0.04, inDir > 0 ? c + t / 2 + 0.04 : c - t / 2, y0, y1, s0, s1, mInt);
      }
    };
    for (const [a, b] of merge(line.iv)) {
      const ops = L.openings.filter((p) => p.o === o && eq(p.c, c) && p.at - p.w / 2 >= a - 0.02 && p.at + p.w / 2 <= b + 0.02).sort((p, q) => p.at - q.at);
      let cur = a;
      const solid = (s0, s1) => piece(s0 === a ? s0 - t / 2 : s0, s1 === b ? s1 + t / 2 : s1, 0, H, true);
      for (const p of ops) {
        const o0 = p.at - p.w / 2, o1 = p.at + p.w / 2;
        solid(cur, o0);
        if (p.sill > 0) piece(o0, o1, 0, p.sill, true);
        piece(o0, o1, p.top, H, false);
        decorate(o, c, p, outer, inDir);
        cur = o1;
      }
      solid(cur, b);
    }
  };

  function decorate(o, c, p, outer, inDir) {
    const o0 = p.at - p.w / 2, o1 = p.at + p.w / 2, fw = 0.2;
    const along = (s0, s1, y0, y1, th, m) => (o === 'h'
      ? box(walls, s0, s1, y0, y1, c - th, c + th, m) : box(walls, c - th, c + th, y0, y1, s0, s1, m));
    if (p.kind === 'window') {
      along(o0, o1, p.sill, p.top, 0.05, mGlass);
      along(o0 - fw, o1 + fw, p.top, p.top + fw, 0.22, mFrame);
      along(o0 - fw, o1 + fw, p.sill - fw, p.sill, 0.3, st.id === 'modern' ? mFrame : mTrim);
      along(o0 - fw, o0, p.sill, p.top, 0.22, mFrame);
      along(o1, o1 + fw, p.sill, p.top, 0.22, mFrame);
      along((o0 + o1) / 2 - 0.07, (o0 + o1) / 2 + 0.07, p.sill, p.top, 0.12, mFrame);
    } else if (p.kind === 'door') {
      along(o0 - fw, o1 + fw, p.top, p.top + fw, 0.3, mFrame);
      along(o0 - fw, o0, 0, p.top, 0.3, mFrame);
      along(o1, o1 + fw, 0, p.top, 0.3, mFrame);
    }
  }

  for (const l of hl.values()) addLine('h', l);
  for (const l of vl.values()) addLine('v', l);

  // ---------- floors, lights, furniture ----------
  const texCache = {};
  const floorMat = (kind, w, d) => {
    texCache[kind] ||= makeTex(kind);
    const t = texCache[kind].clone();
    t.needsUpdate = true;
    t.repeat.set(w / 4, d / 4);
    return new THREE.MeshLambertMaterial({ map: t });
  };
  const floorKind = (r) => (r.type.endsWith('bath') || r.type === 'kitchen' ? 'tile' : r.type === 'bed' ? st.floorBed : st.floorLiving);
  const order = [...L.rooms.filter((r) => !r.parent), ...L.rooms.filter((r) => r.parent)];
  order.forEach((r) => {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), floorMat(floorKind(r), r.w, r.d));
    f.rotation.x = -Math.PI / 2;
    f.position.set(r.x + r.w / 2, r.parent ? 0.05 : 0.03, r.z + r.d / 2);
    world.add(f);
    if (!r.parent) {
      const pl = new THREE.PointLight('#fff1d6', 38, 0, 2);
      pl.position.set(r.x + r.w / 2, 8, r.z + r.d / 2);
      world.add(pl);
    }
  });

  const furn = new THREE.Group(); world.add(furn);
  const fb = (cx, y0, cz, w, h, d, color) => box(furn, cx - w / 2, cx + w / 2, y0, y0 + h, cz - d / 2, cz + d / 2, mat(color));
  for (const r of L.rooms) {
    const cx = r.x + r.w / 2, cz = r.z + r.d / 2;
    if (r.type === 'bed') {
      const awayFromBath = r.att ? (r.att.x > r.x ? -r.att.w / 2 : r.att.w / 2) : 0;
      const bw = r.w < 11 ? 4.5 : 5.5;
      const bxp = cx + awayFromBath;
      const bzp = r.z + r.d - 3.8 - (r.att && Math.abs(bxp - (r.att.x + r.att.w / 2)) < 4 ? 7.5 : 0);
      fb(bxp, 0, bzp, bw, 1.6, 6.8, '#ede6da');
      fb(bxp, 1.6, bzp, bw - 0.3, 0.5, 6.4, '#9aa9c4');
      fb(bxp - bw / 4, 2.1, bzp + 2.7, bw / 2 - 0.4, 0.5, 1.2, '#ffffff');
      fb(bxp + bw / 4, 2.1, bzp + 2.7, bw / 2 - 0.4, 0.5, 1.2, '#ffffff');
      fb(bxp, 0, bzp + 3.6, bw + .3, 3.4, 0.4, '#7a5a3c');
      fb(r.x + 1.6, 0, r.z + 1.2, Math.min(5, r.w - 4), 7, 2, '#8a6a48');
    } else if (r.type === 'lounge') {
      fb(cx, 0, r.z + r.d * 0.62, Math.min(8, r.w - 2), 1.5, 3, '#6d7f8c');
      fb(cx, 1.5, r.z + r.d * 0.62 + 1.2, Math.min(8, r.w - 2), 1.6, 0.7, '#6d7f8c');
      fb(cx, 0, r.z + r.d * 0.35, 3.5, 1.2, 2, '#4a3c30');
      fb(cx, 0, r.z + 1, Math.min(6, r.w - 2), 1.8, 1.2, '#2d2d2d');
      if (r.name.includes('Dining')) { fb(r.x + r.w * 0.78, 0, r.z + r.d * 0.3, 3, 2.5, 5, '#8a6a48'); }
    } else if (r.type === 'drawing') {
      fb(cx, 0, r.z + r.d * 0.7, Math.min(9, r.w - 2), 1.5, 3, '#8f5f4a');
      fb(cx, 1.5, r.z + r.d * 0.7 + 1.2, Math.min(9, r.w - 2), 1.7, 0.8, '#8f5f4a');
      fb(cx, 0, r.z + r.d * 0.4, 3.2, 1.2, 2.2, '#4a3c30');
      fb(cx, 0, r.z + 1.6, 3, 1.5, 2.5, '#8f5f4a');
    } else if (r.type === 'dining') {
      fb(cx, 0, cz, Math.min(6, r.w - 2), 2.5, 3.6, '#7a5a3c');
      for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) fb(cx + i * 1.2, 0, cz + j * 2.3, 1.3, 1.6, 1.3, '#3b3b3b');
    } else if (r.type === 'kitchen') {
      fb(cx, 0, r.z + r.d - 1.1, r.w - 0.8, 3, 2, '#e9e4d8');
      fb(cx, 3, r.z + r.d - 1.1, r.w - 0.8, 0.15, 2.1, '#383838');
      fb(r.x + r.w - 1.5, 0, r.z + 1.2, 2.6, 6, 2.4, '#c9ced1');
    } else if (r.type.endsWith('bath')) {
      const wx = r.x + (r.w > 5 ? 1.2 : 1.1);
      fb(cx, 0, r.z + r.d - 1.3, 1.5, 1.4, 2, '#ffffff');
      fb(cx, 2.6, r.z + r.d - 0.4, 1.4, 1.6, 0.4, '#ffffff');
      fb(cx, 0, r.z + 0.9, 1.4, 2.8, 1.2, '#ffffff');
    }
  }

  // ---------- roof ----------
  const ov = 0.45;
  box(roofG, B.x - ov, B.x + B.w + ov, H, H + 0.6, B.z - ov, B.z + B.d + ov, mat(st.roof));
  const pm = st.id === 'spanish' ? mat(st.roof) : st.id === 'modern' ? mTrim : mExt;
  const ph = 2.6, pt = 0.6;
  box(roofG, B.x - ov, B.x + B.w + ov, H + 0.6, H + 0.6 + ph, B.z - ov, B.z - ov + pt, pm);
  box(roofG, B.x - ov, B.x + B.w + ov, H + 0.6, H + 0.6 + ph, B.z + B.d + ov - pt, B.z + B.d + ov, pm);
  box(roofG, B.x - ov, B.x - ov + pt, H + 0.6, H + 0.6 + ph, B.z - ov, B.z + B.d + ov, pm);
  box(roofG, B.x + B.w + ov - pt, B.x + B.w + ov, H + 0.6, H + 0.6 + ph, B.z - ov, B.z + B.d + ov, pm);
  if (st.id === 'classic') box(roofG, B.x - 1, B.x + B.w + 1, H + 0.6 + ph, H + 1 + ph, B.z - 1, B.z + B.d + 1, mTrim);
  if (st.id === 'classic') {
    const c0 = 0.9, ct = 0.6, x0 = B.x - c0, x1 = B.x + B.w + c0, z0 = B.z - c0, z1 = B.z + B.d + c0;
    box(world, x0, x1, H - 0.7, H, z0, z0 + ct, mTrim); box(world, x0, x1, H - 0.7, H, z1 - ct, z1, mTrim);
    box(world, x0, x0 + ct, H - 0.7, H, z0, z1, mTrim); box(world, x1 - ct, x1, H - 0.7, H, z0, z1, mTrim);
  }
  // water tank
  box(roofG, B.x + B.w - 5, B.x + B.w - 2, H + 0.6, H + 3.4, B.z + B.d - 4, B.z + B.d - 1.5, mat('#2f3f4a'));

  // ---------- porch ----------
  const pd = Math.min(rule.front - 1, 7);
  box(world, B.x - 0.4, B.x + B.w + 0.4, 9.3, 9.8, B.z - pd, B.z + 0.4, st.id === 'spanish' ? mat(st.roof) : mTrim);
  if (st.id === 'spanish') box(world, B.x - 0.4, B.x + B.w + 0.4, 9.8, 10.1, B.z - pd, B.z - pd + 0.5, mat('#8e3f22'));
  if (st.deco === 'wood') {
    const dx0 = mainDoor.at - mainDoor.w / 2 - 0.2, dx1 = mainDoor.at + mainDoor.w / 2 + 0.2;
    box(world, dx0 - 1.6, dx0, 0, H, B.z - 0.45, B.z - 0.2, mAccent);
    box(world, dx1, dx1 + 1.6, 0, H, B.z - 0.45, B.z - 0.2, mAccent);
    box(world, dx0, dx1, 7.4, H, B.z - 0.45, B.z - 0.2, mAccent);
  }
  const nP = Math.max(2, Math.round(B.w / 12) + 1);
  for (let i = 0; i < nP; i++) {
    const px = B.x + 0.9 + (i * (B.w - 1.8)) / (nP - 1), pz = B.z - pd + 0.7;
    if (st.pillar === 'box') box(world, px - 0.35, px + 0.35, 0, 9.3, pz - 0.35, pz + 0.35, mTrim, true);
    else {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 9.3, 18), st.pillar === 'column' ? mTrim : mExt);
      cyl.position.set(px, 4.65, pz); world.add(cyl);
      colliders.push({ x0: px - 0.5, x1: px + 0.5, z0: pz - 0.5, z1: pz + 0.5 });
      box(world, px - 0.8, px + 0.8, 8.9, 9.3, pz - 0.8, pz + 0.8, st.pillar === 'column' ? mTrim : mAccent);
      box(world, px - 0.8, px + 0.8, 0, 0.5, pz - 0.8, pz + 0.8, st.pillar === 'column' ? mTrim : mAccent);
    }
  }
  // paved walkway to door
  plane(mainDoor.at - 2, mainDoor.at + 2, 0, B.z, 0.02, mat('#d5d1c6'));

  // car & trees
  if (rule.front >= 10) {
    const carX = gateX > W / 2 ? Math.max(8, W * 0.25) : Math.min(W - 8, W * 0.75);
    const car = new THREE.Group();
    const cb = (cx, cy, cz, w, h, d, c) => bx(car, cx, cy, cz, w, h, d, mat(c));
    cb(0, 1.5, 0, 14, 1.7, 5.8, '#b23a3a'); cb(-0.5, 2.9, 0, 7.5, 1.3, 5.2, '#a33333');
    cb(-0.5, 2.9, 0, 7.6, 1.0, 5.3, '#9fc4d6');
    [[-4.5, 2.8], [4.5, 2.8], [-4.5, -2.8], [4.5, -2.8]].forEach(([x, z]) => {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.9, 14), mat('#1b1b1b'));
      wh.rotation.x = Math.PI / 2; wh.position.set(x, 1.1, z); car.add(wh);
    });
    car.position.set(carX, 0, Math.min(rule.front / 2 + 0.5, 6.5));
    world.add(car);
    colliders.push({ x0: carX - 7, x1: carX + 7, z0: car.position.z - 3, z1: car.position.z + 3 });
  }
  const tree = (x, z, s = 1) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.35 * s, 5 * s, 8), mat('#6b4d34'));
    t.position.set(x, 2.5 * s, z); world.add(t);
    const l = new THREE.Mesh(new THREE.SphereGeometry(2.4 * s, 14, 10), mat('#4f8a3c'));
    l.position.set(x, 6.2 * s, z); world.add(l);
    colliders.push({ x0: x - 0.4, x1: x + 0.4, z0: z - 0.4, z1: z + 0.4 });
  };
  tree(1.5, 1.8); tree(W - 1.5, 1.8);
  if (rule.rear >= 4) tree(W / 2, D - 1.6, 0.9);
  tree(-6, -3, 1.2); tree(W + 6, -3, 1.2);

  // ---------- controls ----------
  const state = { mode: 'walk', yaw: Math.PI, pitch: 0, pos: new THREE.Vector3(gateX, EYE, 3), keys: new Set() };
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
    hooks.onMode?.(mode, roofG.visible);
  }
  function setRoof(v) { roofG.visible = v; }
  function resetWalk() { state.pos.set(gateX, EYE, 3); state.yaw = Math.PI; state.pitch = 0; }

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

  const blocked = (x, z, r) => colliders.some((c) => x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r);
  function roomAt(x, z) {
    const hit = L.rooms.filter((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d);
    return (hit.find((r) => r.parent) || hit[0])?.name || (z < B.z ? 'Porch & lawn' : z < 0 ? 'Road' : 'Outside');
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

  let raf, last = performance.now(), lastRoom = '';
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
    } else orbit.update();
    renderer.render(scene, camera);
  }
  setMode('walk');
  raf = requestAnimationFrame(loop);

  return {
    setMode, setRoof, resetWalk,
    get roofVisible() { return roofG.visible; },
    get mode() { return state.mode; },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('pointerup', onUp);
      orbit.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
