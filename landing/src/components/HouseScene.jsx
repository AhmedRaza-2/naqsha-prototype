import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/*
 * Scroll-scrubbed house. Everything is procedural (no downloaded assets) and drawn in the brand palette.
 * `progress` is a Motion value 0..1 that covers the pinned hero. It is read outside React's render cycle,
 * and frames are only rendered while the camera is still catching up with the scroll.
 *
 * Story (what each part of the scroll communicates):
 *   0.00-0.28  approach from the road, the gate swings open
 *   0.28-0.46  glide up the drive to the porch
 *   0.46-0.66  slow down while the front door opens, light spills out
 *   0.66-0.92  walk through the door into the lit hall (the page then flashes to the next section)
 */

const PAL = { earth: 0x3a2f2c, steel: 0x394845, ash: 0xc8d0c8, linen: 0xefeae2, paper: 0xfbf8f1 };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// camera / look-at control points (metres). The house front is the plane z = 0, the door is at x = 3.3.
const POS = [[-4.4, 3.4, 37], [-1.1, 2.7, 17.5], [2.5, 1.95, 10.5], [3.3, 1.72, 6.4], [3.3, 1.62, 0.8], [3.3, 1.56, -4.2]];
const LOOK = [[1.4, 3.6, 0], [2.4, 2.3, 0], [3.3, 1.85, 0], [3.3, 1.65, -3], [3.3, 1.55, -6], [3.3, 1.5, -7]];
// scroll progress -> fraction of the path (slow while the gate and the front door open so each reads clearly)
const PACE = [[0, 0], [0.38, 0.64], [0.5, 0.755], [0.64, 0.795], [0.92, 1], [1, 1]];

function pace(p) {
  for (let i = 1; i < PACE.length; i++) {
    if (p <= PACE[i][0]) {
      const [p0, s0] = PACE[i - 1], [p1, s1] = PACE[i];
      return s0 + ((p - p0) / (p1 - p0)) * (s1 - s0);
    }
  }
  return 1;
}

export default function HouseScene({ progress, still = false, onReady, onFail }) {
  const host = useRef(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const small = window.matchMedia('(max-width: 767px)').matches;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (err) {
      onFail?.();                                              // no WebGL: the poster and headline still work
      return undefined;
    }
    const maxPixels = small ? 1.5e6 : 2.3e6;                  // pixel budget: integrated GPUs choke on 4K plus shadows and anti-aliasing
    const dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    
    el.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' });

    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      window.__naqsha = { ...(window.__naqsha || {}), contextLost: true };
      onFail?.();
    });
    window.__naqsha = { ...(window.__naqsha || {}), webgl: renderer.getContext().getParameter(renderer.getContext().VERSION) };

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PAL.linen, 60, 230);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.32;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);

    // ---------- lights ----------
    scene.add(new THREE.HemisphereLight(PAL.paper, PAL.ash, 1.05));
    const sun = new THREE.DirectionalLight(0xffe2bd, 2.7);
    sun.position.set(-15, 22, 20);
    sun.castShadow = true;
    const sm = small ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    const hallLight = new THREE.PointLight(0xffe6c2, 0, 14, 1.8);
    hallLight.position.set(3.3, 2.3, -2.2);
    scene.add(hallLight);

    // ---------- materials ----------
    const mat = (c, r = 0.92, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const M = {
      paper: mat(PAL.paper), linen: mat(PAL.linen), ash: mat(PAL.ash), steel: mat(PAL.steel, 0.7), earth: mat(PAL.earth, 0.8),
      lawn: mat(0xa9b9aa, 1), hedge: mat(0x6d8577, 1), leaf: mat(0x7d9585, 1), leaf2: mat(0x93a998, 1),
      road: mat(0xb7beb7, 1), kerb: mat(0xdcd8cd, 1), hall: mat(0xeee6d8, 0.95), hill: mat(0xb9c4bc, 1), hill2: mat(0xa8b6ae, 1),
      glass: new THREE.MeshStandardMaterial({ color: 0x2f423e, roughness: 0.12, metalness: 0.65 }),
      glow: new THREE.MeshBasicMaterial({ color: 0xfff1d6, fog: false }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
      warmGlass: new THREE.MeshStandardMaterial({ color: 0x3a423c, roughness: 0.2, metalness: 0.4, emissive: 0xffc98a, emissiveIntensity: 0.32 }),
    };
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const box = (parent, m, x0, x1, y0, y1, z0, z1, shadow = true) => {
      const b = new THREE.Mesh(unit, m);
      b.scale.set(x1 - x0, y1 - y0, z1 - z0);
      b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      b.castShadow = shadow; b.receiveShadow = true;
      parent.add(b);
      return b;
    };

    const world = new THREE.Group();
    scene.add(world);

    // ---------- ground, street, drive ----------
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), M.lawn);
    lawn.rotation.x = -Math.PI / 2; lawn.receiveShadow = true; world.add(lawn);
    box(world, M.road, -300, 300, -0.02, 0.02, 17, 23, false);
    box(world, M.kerb, -300, 300, 0, 0.12, 14.4, 17, false);
    box(world, M.kerb, -300, 300, 0, 0.12, 23, 25.4, false);
    for (let x = -40; x < 40; x += 4.5) box(world, M.paper, x, x + 2.2, 0.02, 0.03, 19.85, 20.15, false);   // lane dashes
    box(world, M.kerb, 1.5, 5.1, 0, 0.05, 2.6, 14.4, false);                 // drive
    box(world, M.kerb, 1.0, 5.6, 0, 0.12, -0.2, 2.7, false);                  // porch floor

    // ---------- the house ----------
    const house = new THREE.Group();
    world.add(house);
    box(house, M.linen, -5.4, 0.4, 0, 3.3, -12, 0);                          // left ground mass
    box(house, M.linen, 0.4, 5.4, 0, 3.3, -12, -6);                          // rear right mass (back wall of the hall)
    box(house, M.hall, 0.4, 5.4, 0, 0.05, -6, 0, false);                     // hall floor
    box(house, M.paper, 0.4, 5.4, 3.15, 3.45, -12, 2.6);                     // terrace slab, also the porch roof
    box(house, M.paper, 5.3, 5.45, 0, 3.15, -6, 0);                          // hall right wall
    box(house, M.steel, 0.4, 2.45, 0, 3.15, -0.25, 0);                       // entrance frame
    box(house, M.steel, 4.15, 5.4, 0, 3.15, -0.25, 0);
    box(house, M.steel, 2.45, 4.15, 2.7, 3.15, -0.25, 0);
    box(house, M.paper, -5.4, 1.2, 3.45, 6.5, -12, 0.9);                     // upper volume, cantilevers over the porch
    box(house, M.earth, -5.48, 1.28, 6.5, 6.62, -12.08, 0.98);               // upper parapet cap
    // terrace parapet
    box(house, M.earth, 1.28, 5.45, 3.45, 4.25, 2.4, 2.6);
    box(house, M.earth, 5.25, 5.45, 3.45, 4.25, -12, 2.6);
    // porch columns
    box(house, M.earth, 0.9, 1.1, 0, 3.15, 2.3, 2.5);
    box(house, M.earth, 5.1, 5.3, 0, 3.15, 2.3, 2.5);
    // timber slat screen on the upper floor
    for (let i = 0; i < 11; i++) box(house, M.earth, -1.15 + i * 0.21, -1.15 + i * 0.21 + 0.07, 3.75, 6.25, 0.9, 1.04, false);

    const windowAt = (x0, x1, y0, y1, z, glassMat = M.glass) => {
      box(house, glassMat, x0, x1, y0, y1, z, z + 0.05, false);
      const f = 0.09;
      [[x0 - f, x1 + f, y0 - f, y0, 0], [x0 - f, x1 + f, y1, y1 + f, 0], [x0 - f, x0, y0, y1, 0], [x1, x1 + f, y0, y1, 0]]
        .forEach(([a, b, c, d]) => box(house, M.earth, a, b, c, d, z, z + 0.11, false));
      box(house, M.earth, (x0 + x1) / 2 - 0.03, (x0 + x1) / 2 + 0.03, y0, y1, z, z + 0.1, false);
    };
    windowAt(-4.6, -0.9, 0.7, 2.8, 0);
    windowAt(-5.0, -3.35, 4.2, 6.0, 0.9);
    windowAt(-2.95, -1.5, 4.2, 6.0, 0.9, M.warmGlass);

    // glowing hall back wall and the inside of the hall
    const glowPanel = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.5), M.glow);
    glowPanel.position.set(3.3, 1.35, -5.98); house.add(glowPanel);
    box(house, M.paper, 2.0, 4.6, 2.35, 3.15, -6.0, -5.9, false);

    // entrance leaves, hinged at the jambs and swinging into the hall
    const leaf = (hingeX, dir) => {
      const g = new THREE.Group();
      g.position.set(hingeX, 0, -0.1);
      const w = 0.85;
      const x0 = dir > 0 ? 0 : -w;
      box(g, M.earth, x0, x0 + w, 0, 2.7, -0.03, 0.03, false);
      for (let i = 1; i < 5; i++) box(g, M.steel, x0 + (w / 5) * i - 0.01, x0 + (w / 5) * i + 0.01, 0.1, 2.6, 0.03, 0.045, false);
      box(g, M.ash, dir > 0 ? w - 0.14 : -w + 0.1, dir > 0 ? w - 0.1 : -w + 0.14, 1.0, 1.25, 0.03, 0.07, false);
      house.add(g);
      return g;
    };
    const leafL = leaf(2.45, +1);
    const leafR = leaf(4.15, -1);

    // wall lamps and planters
    [[2.05, 2.45], [4.55, 2.45]].forEach(([x, y]) => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), M.lamp); s.position.set(x, y, 0.1); house.add(s); });
    box(house, M.earth, 5.45, 6.2, 0, 0.5, 1.2, 2.2);
    box(house, M.earth, -0.6, 0.2, 0, 0.5, 1.2, 2.2);

    // ---------- boundary wall and gate ----------
    const wallZ = [7.2, 7.5];
    box(world, M.paper, -26, 1.5, 0, 1.6, wallZ[0], wallZ[1]);
    box(world, M.paper, 5.1, 26, 0, 1.6, wallZ[0], wallZ[1]);
    box(world, M.earth, -26, 1.5, 1.6, 1.68, wallZ[0] - 0.04, wallZ[1] + 0.04, false);
    box(world, M.earth, 5.1, 26, 1.6, 1.68, wallZ[0] - 0.04, wallZ[1] + 0.04, false);
    [[1.4, 1.9], [4.7, 5.2]].forEach(([a, b]) => { box(world, M.earth, a, b, 0, 2.3, 7.05, 7.65); box(world, M.paper, a - 0.05, b + 0.05, 2.3, 2.42, 7.0, 7.7); });
    const gate = (hingeX, dir) => {
      const g = new THREE.Group();
      g.position.set(hingeX, 0, 7.35);
      const w = 1.6, x0 = dir > 0 ? 0 : -w;
      box(g, M.steel, x0, x0 + w, 0.15, 0.25, -0.03, 0.03, false);
      box(g, M.steel, x0, x0 + w, 1.55, 1.65, -0.03, 0.03, false);
      for (let i = 0; i <= 8; i++) box(g, M.steel, x0 + (w / 8) * i - 0.02, x0 + (w / 8) * i + 0.02, 0.15, 1.65, -0.02, 0.02, false);
      world.add(g);
      return g;
    };
    const gateL = gate(1.9, +1);
    const gateR = gate(4.7, -1);
    box(world, M.hedge, -6, 1.3, 0, 0.95, 6.4, 7.0, false);
    box(world, M.hedge, 5.2, 6, 0, 0.95, 6.4, 7.0, false);

    // ---------- neighbours, trees, hills ----------
    const neighbour = (x0, x1, h, m) => {
      box(world, m, x0, x1, 0, h, -12, 0.4);
      for (let r = 0; r < Math.floor(h / 3); r++) {
        for (let x = x0 + 1.6; x < x1 - 2; x += 3.4) box(world, M.glass, x, x + 1.6, 0.8 + r * 3, 2.4 + r * 3, 0.4, 0.45, false);
      }
      box(world, M.paper, x0, x1, 0, 1.5, 7.2, 7.5);
    };
    neighbour(-23, -7, 5.2, M.linen);
    neighbour(7, 23, 6.8, M.paper);
    const tree = (x, z, s = 1) => {
      const t = new THREE.Group(); t.position.set(x, 0, z);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.16 * s, 2 * s, 7), M.earth);
      trunk.position.y = s; trunk.castShadow = true; t.add(trunk);
      [[0, 2.5, 0, 1.15, M.leaf], [0.6, 2.1, 0.2, 0.85, M.leaf2], [-0.55, 2.2, -0.2, 0.9, M.leaf]].forEach(([a, b, c, r, m]) => {
        const s2 = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), m);
        s2.position.set(a * s, b * s, c * s); s2.castShadow = true; t.add(s2);
      });
      world.add(t);
    };
    [[-8.5, 4, 1.25], [9.2, 5, 1.05], [-3.4, 4.6, 0.7], [-17, 3, 1.3], [16, 2.5, 1.2], [-14, 12.5, 1.1], [12.5, 12, 1.0]].forEach(([x, z, s]) => tree(x, z, s));
    [[-85, -190, 80, 0.5, M.hill], [60, -210, 95, 0.45, M.hill2], [-10, -230, 110, 0.4, M.hill]].forEach(([x, z, r, k, m]) => {
      const h = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 14), m);
      h.scale.y = k; h.position.set(x, -r * k * 0.55, z); world.add(h);
    });

    // ---------- camera rig ----------
    const posCurve = new THREE.CatmullRomCurve3(POS.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    const lookCurve = new THREE.CatmullRomCurve3(LOOK.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    const tmp = new THREE.Vector3();
    let lift = 0;   // how far above the target the camera aims at the start (puts the house low in frame, sky above for the headline)

    const place = (p) => {
      const s = pace(p);
      camera.position.copy(posCurve.getPointAt(s));
      lookCurve.getPointAt(s, tmp);
      camera.lookAt(tmp.x, tmp.y + lift * (1 - smooth(0, 0.4, p)), tmp.z);
      const door = smooth(0.46, 0.66, p);
      leafL.rotation.y = door * 1.62;
      leafR.rotation.y = -door * 1.62;
      const g = smooth(0.2, 0.42, p);
      gateL.rotation.y = g * 1.55;
      gateR.rotation.y = -g * 1.55;
      hallLight.intensity = door * 55;
    };

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setPixelRatio(Math.min(dpr, Math.sqrt(maxPixels / (w * h))));
      renderer.setSize(w, h, false);
      const a = w / h;
      camera.aspect = a;
      camera.fov = a < 0.8 ? 66 : a < 1.2 ? 52 : 40;
      lift = a < 0.8 ? 3.4 : a < 1.2 ? 2.0 : 1.3;
      camera.updateProjectionMatrix();
      request();
    };

    // ---------- render on demand ----------
    let cur = 0, target = 0, raf = 0, first = true, dead = false;
    const frame = () => {
      raf = 0;
      if (dead) return;
      const d = target - cur;
      cur = Math.abs(d) < 0.0006 ? target : cur + d * 0.16;      // light inertia on top of the scroll smoothing
      place(cur);
      renderer.render(scene, camera);
      if (first) { first = false; onReady?.(); }
      if (cur !== target) raf = requestAnimationFrame(frame);
    };
    function request() { if (!raf && !dead) raf = requestAnimationFrame(frame); }

    let off = () => {};
    if (!still && progress) {
      target = cur = progress.get();
      off = progress.on('change', (v) => { target = v; request(); });
    }
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      off(); ro.disconnect();
      scene.traverse((o) => { o.geometry?.dispose?.(); });
      Object.values(M).forEach((m) => m.dispose());
      pmrem.dispose(); renderer.dispose();
      renderer.domElement.remove();
    };
  }, [progress, still, onReady, onFail]);

  return <div ref={host} className="absolute inset-0" aria-hidden="true" />;
}
