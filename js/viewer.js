// The 3D walkthrough: walk in first person, follow a visitor in third person, take a guided tour, or look from outside.
// Doors open and close, the stairs can be climbed, and the camera has several views. The house itself is built by
// scene.js (buildScene); this file moves a person through it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildScene, prepareRenderer, SITE_DEFAULT, STOREY, H, EYE, disposeScene } from './scene.js';
import { createAmbience } from './ambience.js';

const R = 0.42;                                                  // the visitor's radius (ft)
const DOOR_OPEN = 0.55;                                          // a door is passable once it has swung this far

// ---------------------------------------------------------------- a person
/** A simple person (shalwar kameez), 5.8 ft tall, facing +Z, with a walking cycle: person.walk(phase, amount). */
export function makePerson({ kurta = '#7fa6c8', shalwar = '#ece7da', skin = '#c58f6b', hair = '#1d1815' } = {}) {
  const g = new THREE.Group();
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
  const mk = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const legs = [-0.34, 0.34].map((x) => {
    const p = new THREE.Group(); p.position.set(x, 2.6, 0); g.add(p);
    mk(new THREE.CylinderGeometry(0.27, 0.2, 2.45, 10), M(shalwar), 0, -1.2, 0, p);
    mk(new THREE.BoxGeometry(0.5, 0.25, 0.95), M('#2b2420'), 0, -2.5, 0.2, p);
    return p;
  });
  mk(new THREE.BoxGeometry(1.5, 2.55, 0.9), M(kurta), 0, 3.85, 0);                       // kameez to the knee
  mk(new THREE.BoxGeometry(1.52, 0.55, 0.92), M(shalwar), 0, 2.85, 0);
  const arms = [-1, 1].map((sd) => {
    const p = new THREE.Group(); p.position.set(sd * 0.95, 4.9, 0); g.add(p);
    mk(new THREE.CylinderGeometry(0.22, 0.18, 1.7, 10), M(kurta), 0, -0.8, 0, p);
    mk(new THREE.SphereGeometry(0.2, 10, 8), M(skin), 0, -1.75, 0, p);
    return p;
  });
  mk(new THREE.CylinderGeometry(0.2, 0.22, 0.35, 10), M(skin), 0, 5.2, 0);
  const head = mk(new THREE.SphereGeometry(0.5, 20, 16), M(skin), 0, 5.65, 0);
  head.scale.set(0.92, 1.08, 0.98);
  const cap = mk(new THREE.SphereGeometry(0.53, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M(hair), 0, 5.7, -0.1);
  cap.rotation.x = -0.45;
  for (const sd of [-1, 1]) {
    mk(new THREE.SphereGeometry(0.06, 8, 8), M('#15110f'), sd * 0.18, 5.72, 0.46);
    mk(new THREE.SphereGeometry(0.1, 8, 8), M(skin), sd * 0.47, 5.62, 0);
  }
  mk(new THREE.SphereGeometry(0.07, 8, 8), M('#b4795a'), 0, 5.58, 0.5);
  g.walk = (phase, amount) => {
    const s = Math.sin(phase) * 0.7 * amount;
    legs[0].rotation.x = s; legs[1].rotation.x = -s;
    arms[0].rotation.x = -s * 0.8; arms[1].rotation.x = s * 0.8;
    g.position.y += Math.abs(Math.cos(phase)) * 0.06 * amount;
  };
  return g;
}

/** U: the first-floor layout of a two-storey house (built above the ground floor, stairs between). */
export function createViewer(host, L, styleId, hooks = {}, U = null, colors = {}, siteIn = {}, opts = {}) {
  const { w: W, d: D } = L.plot;
  const { B } = L;
  let site = { ...SITE_DEFAULT, ...siteIn };
  let curColors = { ...colors };

  const renderer = prepareRenderer(new THREE.WebGLRenderer({ antialias: true }));
  let pxRatio = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pxRatio);
  renderer.shadowMap.autoUpdate = false;                          // the shadows are redrawn only when something that casts one moves (the sun, a door, the visitor): the biggest saving per frame
  let shadowDirty = true;
  const amb = createAmbience(renderer);
  let look = opts.look || null, time = opts.time ?? 0.36, light = { fill: 0.5, night: 0, glow: 0.12 };
  host.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
  camera.rotation.order = 'YXZ';

  // everything that depends on the built scene is rebuilt together when the site (boundary wall, floors ...) changes
  let S, scene, roofG, colliders, upperColliders, roofColliders, stairs, doors, pool = [], person, lastFloorLevel = 0;
  const state = { mode: 'walk', yaw: Math.PI, pitch: 0, pos: new THREE.Vector3(0, EYE, 2.5), hs: 0, keys: new Set(), floor: 0, cutaway: 'all', fov: 70, phase: 0, speed: 0, inS: false, lastH: 0 };
  let start = 0;

  let planning = false;                                                  // while the tour is planned every door counts as open (the visitor opens each as it comes near)
  const solid = (c) => !c.door || (!planning && c.door.t < DOOR_OPEN);   // a wall, or a door that is still (nearly) shut
  const blocked = (x, z, r, lvl) => (lvl === 2 ? roofColliders : lvl ? upperColliders : colliders).some((c) => x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r && solid(c));
  const inStairs = (x, z) => !!stairs && x > stairs.room.x + 0.05 && x < stairs.room.x + stairs.room.w - 0.05 && z > stairs.room.z + 0.05 && z < stairs.room.z + stairs.room.d - 0.05;
  const heightAt = (x, z, floor) => (inStairs(x, z) ? (stairs.hxz ? stairs.hxz(x, z, floor) : stairs.h(stairs.alongX ? x - stairs.room.x : z - stairs.room.z)) : floor * STOREY);   // the flights between the floors only
  /** The walking surface at the visitor's own height: with the way on up to the roof there are two flights over each other, and the one nearest wins. */
  const surfaceAt = (x, z, ref) => (stairs && stairs.hz ? stairs.hz(x, z, ref) : heightAt(x, z, state.floor));
  const levelAt = (x, z, floor) => (inStairs(x, z) ? (heightAt(x, z, floor) > STOREY / 2 ? 1 : 0) : floor);

  function bind(newS, keepPos) {
    if (S) { scene.remove(person); disposeScene(S.scene); }
    S = newS; scene = S.scene; roofG = S.roofG; colliders = S.colliders; upperColliders = S.upperColliders; roofColliders = S.roofColliders; stairs = S.stairs; doors = S.doors;
    pool = Array.from({ length: 8 }, () => { const p = new THREE.PointLight('#ffe9c8', 30, 26, 2); scene.add(p); return p; });
    amb.forget(); applyTime();
    person ||= makePerson();
    scene.add(person);
    person.visible = state.mode === 'follow';
    // the visitor starts just inside the gate, in line with the front door, or beside it if the car is parked there
    const hit = (x, z) => colliders.some((c) => { const m = c.k === 'car' ? 1.6 : R; return x > c.x0 - m && x < c.x1 + m && z > c.z0 - m && z < c.z1 + m && solid(c); });     // a car is wider than its box: start well clear of it
    start = (() => {
      for (let k = 0; k <= 40; k++) for (const sg of [1, -1]) {
        const x = S.gateX + sg * k * 0.5;
        if (x > S.gateLo + R && x < S.gateHi - R && !hit(x, 2.5)) return x;
      }
      return S.gateX;
    })();
    if (!keepPos) { state.pos.set(start, EYE, 2.5); state.floor = 0; state.hs = 0; state.onRoofDeck = false; state.yaw = Math.PI; state.pitch = 0; }
    applyCutaway();
    hooks.onCars?.(S.carsInfo);
    if (/[?&]debug3d/.test(location.search)) window.__walk = { camera, orbit, setMode: (m) => setMode(m), move: (a, b) => move(a, b), onRoof: () => onRoof(), roofColliders, carsInfo: S.carsInfo, tour, planPath: (...a) => planPath(...a), level: () => level(), state, colliders, upperColliders, R, stairs, doors, STOREY, roomAt: (x, z) => roomAt(x, z), rooms: L.rooms, upRooms: U ? U.rooms : null, mainDoor: L.openings.find((o) => o.main), openings: L.openings, B, gateX: S.gateX, gateLo: S.gateLo, gateHi: S.gateHi, start };   // for tests
  }

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enabled = false;
  orbit.target.set(W / 2, 0, D / 2);
  orbit.enableDamping = true; orbit.dampingFactor = 0.09;           // smooth stop instead of a jerk
  orbit.zoomToCursor = false; orbit.zoomSpeed = 0.9;                // the wheel zooms straight in and out of the middle of the view: no sideways drift
  orbit.minDistance = 6; orbit.maxDistance = Math.max(W, D) * 3.2;  // cannot zoom through the house or lose it in the sky
  orbit.panSpeed = 0.9; orbit.rotateSpeed = 0.8; orbit.screenSpacePanning = true;

  function build(keepPos) {
    bind(buildScene(renderer, L, styleId, U, { colors: curColors, furniture: true, site, look }), keepPos);
    const built = S;
    Promise.all(S.furnReady).then(() => { if (S !== built) return; amb.forget(); applyTime(); hooks.onReady?.(); });
  }

  // ---------- the time of day and the interior look ----------
  function applyTime() {
    if (!S) return;
    light = amb.apply(S, time);
    for (const p of pool) { p.intensity = 30 * light.fill; p.color.set(light.night > 0.4 ? '#ffd7a0' : '#ffe9c8'); }
    shadowDirty = true;
  }
  function setTime(t) { time = Math.max(0, Math.min(1, t)); applyTime(); placeLights(); }
  function setLook(id) { look = id; S.setLook(id); amb.forget(); applyTime(); }

  // ---------- views ----------
  const FIRST_PERSON = new Set(['walk']);
  const MOVING = new Set(['walk', 'follow', 'tour']);
  const ORBIT = ['orbit', 'top', 'street', 'showcase', 'doll'];
  function applyCutaway() {
    const c = state.cutaway, orbiting = !MOVING.has(state.mode);
    const hideRoof = orbiting;
    roofG.visible = !hideRoof;
    S.storeyG[1] && (S.storeyG[1].visible = !(orbiting && c === 'ground'));
    S.midG.visible = !(orbiting && c === 'ground');
    if (S.stairsG) S.stairsG.visible = true;
  }
  const dist = Math.max(W, D);
  function setMode(mode) {
    state.mode = mode;
    const orb = ORBIT.includes(mode);
    orbit.enabled = orb;
    camera.near = orb ? 1.2 : 0.15; camera.far = orb ? 2000 : 900; camera.updateProjectionMatrix();       // far views need the finer depth: the floors and the slab below them flickered into each other
    orbit.autoRotate = mode === 'showcase';
    orbit.autoRotateSpeed = 1.4;
    orbit.minPolarAngle = 0; orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    if (orb) {
      const cx = W / 2, cz = D / 2, top = (U ? STOREY + H : H);
      if (mode === 'top') { camera.position.set(cx, dist * 1.5, cz + 0.01); orbit.target.set(cx, 0, cz); orbit.maxPolarAngle = 0.25; }
      else if (mode === 'street') { camera.position.set(cx + dist * 0.35, top * 0.7, -Math.max(48, dist * 0.8)); orbit.target.set(cx, top * 0.4, B.z); }
      else if (mode === 'doll') { const p = dollPose(); camera.position.copy(p.pos); orbit.target.copy(p.target); }
      else if (mode === 'showcase') { camera.position.set(cx + dist * 0.9, dist * 0.55, cz - dist * 0.9); orbit.target.set(cx, 3, cz); }
      else { camera.position.set(cx + dist * 0.35, dist * 0.95, -D * 0.35); orbit.target.set(cx, 0, cz); }
      orbit.update();
    }
    if (mode === 'walk') { camera.fov = state.fov; camera.updateProjectionMatrix(); }
    person.visible = mode === 'follow';
    if (mode !== 'tour') tour.on = false;
    shadowDirty = true;
    applyCutaway();
    placeLights();
    hooks.onMode?.(mode, roofG.visible);
  }
  /** The dollhouse view: from above and in front, the roof off, every room in sight. */
  function dollPose() { const cx = W / 2, cz = B.z + B.d / 2, k = Math.max(B.w, B.d * 0.9) + (U ? 8 : 0); return { pos: new THREE.Vector3(cx + k * 0.22, k * 1.08 + 12, cz - k * 0.62), target: new THREE.Vector3(cx, U && state.cutaway !== 'ground' ? STOREY : 0, cz + 1) }; }
  function setRoof(v) { roofG.visible = v; shadowDirty = true; }
  function setCutaway(c) { state.cutaway = c; applyCutaway(); shadowDirty = true; hooks.onMode?.(state.mode, roofG.visible); }
  function resetWalk() { state.floor = 0; state.hs = 0; state.inS = false; state.onRoofDeck = false; state.pos.set(start, EYE, 2.5); state.yaw = Math.PI; state.pitch = 0; hooks.onFloor?.(0); if (ORBIT.includes(state.mode) || state.mode === 'rise') setMode('walk'); }
  /** Climb to the first floor (or come back down): the visitor appears just beyond the door of the stairs. */
  function setFloor(f) {
    if (!U) return;
    const at = stairs ? stairs.entry[f ? 1 : 0] : { x: S.stairsRoom.x + S.stairsRoom.w / 2, z: S.stairsRoom.z + S.stairsRoom.d / 2 };
    state.floor = f; state.hs = f * STOREY; state.inS = false; state.onRoofDeck = false;
    state.pos.set(at.x, EYE + f * STOREY, at.z);
    if (!MOVING.has(state.mode)) setMode('walk');
    placeLights();
    hooks.onFloor?.(f);
  }
  function setFov(v) { state.fov = Math.max(45, Math.min(90, v)); }                  // the loop eases the camera towards it

  // ---------- doors ----------
  const hint = () => (state.inS ? (state.lastH > STOREY / 2 ? 1 : 0) : state.floor);   // on a turning stair, the floor at its foot is the one the visitor came from
  const level = () => (inStairs(state.pos.x, state.pos.z) && stairs.hz ? (surfaceAt(state.pos.x, state.pos.z, state.hs) > STOREY / 2 ? 1 : 0) : levelAt(state.pos.x, state.pos.z, hint()));
  const doorsHere = () => doors.filter((d) => (d.roof ? onRoof() : !onRoof() && (d.upper ? 1 : 0) === level()));
  function toggleDoor(d) { d.target = d.target ? 0 : 1; }
  /** What the visitor calls a door: "Main gate", "Front door", "Terrace door", "Master Bed door". */
  function doorLabel(d) {
    if (d.gate) return 'Main gate';
    if (d.terraceDoor) return 'Terrace door';
    if (d.roof) return 'Roof room door';
    if (d.main) return 'Front door';
    const rm = ((d.upper ? U : L).rooms || []).find((r) => r.id === d.name);
    return rm && rm.name ? `${rm.name} door` : 'Door';
  }
  function setAllDoors(open) { for (const d of doors) d.target = open ? 1 : 0; }
  function nearestDoor(maxDist = 7) {
    const fx = -Math.sin(state.yaw), fz = -Math.cos(state.yaw);
    let best = null, bd = maxDist;
    for (const d of doorsHere()) {
      const dx = d.x - state.pos.x, dz = d.z - state.pos.z, dd = Math.hypot(dx, dz);
      if (dd < bd && (dx * fx + dz * fz) / Math.max(dd, 0.01) > 0.15) { bd = dd; best = d; }
    }
    return best;
  }
  const ray = new THREE.Raycaster();
  function clickDoor(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const objs = [];
    for (const d of doorsHere()) (d.kind === 'swing' ? d.mesh : d.slide).traverse((q) => q.isMesh && objs.push(q));
    const hit = ray.intersectObjects(objs, false)[0];
    if (hit && hit.distance < 11) { toggleDoor(hit.object.userData.door || hit.object.parent?.userData.door); return true; }
    return false;
  }

  // ---------- lights follow the visitor ----------
  function placeLights() {
    const moving = MOVING.has(state.mode), lvl = moving ? level() : (U && state.cutaway !== 'ground' ? 1 : 0), here = lvl ? U : L;
    const cx = !moving ? orbit.target.x : person.visible ? person.position.x : camera.position.x, cz = !moving ? orbit.target.z : person.visible ? person.position.z : camera.position.z;
    const rooms = here.rooms.filter((r) => !r.parent).map((r) => ({ r, d: Math.hypot(r.x + r.w / 2 - cx, r.z + r.d / 2 - cz) })).sort((a, b) => a.d - b.d);
    // a lamp keeps its room while that room stays among the nearest few; reshuffling them every step made the light jump (a flicker)
    const want = rooms.slice(0, pool.length), key = (r) => lvl + ':' + r.id;
    const keep = new Set(want.map((it) => key(it.r)));
    const free = pool.filter((p) => !p.userData.key || !keep.has(p.userData.key));
    const taken = new Set(pool.filter((p) => p.userData.key && keep.has(p.userData.key)).map((p) => p.userData.key));
    for (const it of want) {
      if (taken.has(key(it.r))) continue;
      const p = free.shift(); if (!p) break;
      p.userData.key = key(it.r); taken.add(p.userData.key);
      p.position.set(it.r.x + it.r.w / 2, lvl * STOREY + 8.4, it.r.z + it.r.d / 2);
    }
    for (const p of pool) p.visible = !!p.userData.key && keep.has(p.userData.key) && (moving || light.night > 0.25);      // outside views: the rooms are lit only once it gets dark
  }

  // ---------- input ----------
  let drag = null;
  const el = renderer.domElement;
  const onDown = (e) => { if (MOVING.has(state.mode) && state.mode !== 'tour') { drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }; el.setPointerCapture?.(e.pointerId); } };
  const onMove = (e) => {
    if (!drag) return;
    state.yaw -= (e.clientX - drag.x) * 0.0045;
    state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch - (e.clientY - drag.y) * 0.0045));
    drag = { ...drag, x: e.clientX, y: e.clientY };
  };
  const onUp = (e) => {
    if (drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5 && MOVING.has(state.mode)) clickDoor(e);   // a click, not a drag
    drag = null;
  };
  const onWheel = (e) => { if (state.mode === 'walk') { e.preventDefault(); setFov(state.fov + Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.03); hooks.onFov?.(state.fov); } };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  const kd = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    state.keys.add(k);
    if (e.key.startsWith('Arrow')) e.preventDefault();
    if (k === 'f' && MOVING.has(state.mode)) { const d = nearestDoor(); if (d) toggleDoor(d); }
  };
  const ku = (e) => state.keys.delete(e.key.toLowerCase());
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);

  function roomAt(x, z) {
    const lvl = levelAt(x, z, state.floor), here = lvl ? U : L;
    const hit = here.rooms.filter((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d);
    if (lvl) {
      const terrace = (U.open || []).find((p) => x >= p.x && x <= p.x + p.w && z >= p.z && z <= p.z + p.d);
      return (hit.find((r) => r.parent) || hit[0])?.name || (terrace ? 'Terrace' : x >= B.x && x <= B.x + B.w && z >= B.z && z <= B.z + B.d ? 'Terrace' : 'Outside');
    }
    const space = (S.open || []).find((p) => x >= p.x && x <= p.x + p.w && z >= p.z && z <= p.z + p.d);
    return (hit.find((r) => r.parent) || hit[0])?.name || space?.name || (z < 0 ? 'Road' : z < B.z ? (S.porch ? 'Lawn' : 'Porch & lawn') : 'Outside');
  }

  // ---------- one step of movement, shared by walking, following and the tour ----------
  /** On the roof (the stair head, the stair-head room and the open roof): above one and a half storeys. */
  const onRoof = () => state.hs > STOREY * 1.5;
  /** Which walls stop the visitor: the roof's (the stair-head room, the parapet, the guards round the stair opening) only at the height of the roof
   *  deck; on the last flight up to it (above one and a half storeys, below the deck) the stairwell's own walls are the ones that count. */
  const collLvl = () => (state.hs >= STOREY * 2 - 0.6 ? 2 : state.hs > STOREY * 1.5 ? 1 : level());
  function move(dx, dz) {
    if (!blocked(state.pos.x + dx, state.pos.z, R, collLvl())) state.pos.x += dx;
    if (!blocked(state.pos.x, state.pos.z + dz, R, collLvl())) state.pos.z += dz;
    return settle();
  }
  // the height under the visitor: on the flight it follows the steps; leaving the flight at the top lands on the first floor
  function settle() {
    if (inStairs(state.pos.x, state.pos.z)) { const h = stairs.hz ? surfaceAt(state.pos.x, state.pos.z, state.hs) : heightAt(state.pos.x, state.pos.z, hint()); state.inS = true; state.lastH = h; state.onRoofDeck = false; return h; }
    if (state.inS) {                                                // left the flight: at the head of the roof stair that is the stair-head room, on the roof
      state.inS = false;
      if (state.lastH > STOREY * 1.5) { state.onRoofDeck = true; if (state.floor !== 1) { state.floor = 1; hooks.onFloor?.(1); } return 2 * STOREY; }
      const f = state.lastH > STOREY / 2 ? 1 : 0; if (f !== state.floor) { state.floor = f; hooks.onFloor?.(f); }
    }
    if (state.onRoofDeck) return 2 * STOREY;
    return state.floor * STOREY;
  }

  // ---------- the guided tour: a visitor walks through every room ----------
  const tour = { on: false, path: [], i: 0, wait: 0, pan: 1, end: false };
  const GR = 0.25;
  function planPath(from, targets) {
    // breadth-first search over a grid of the plot, on two levels; the stairs room joins them
    const nx = Math.ceil((W + 4) / GR), nz = Math.ceil((D + 4) / GR), x0 = -2;
    const idx = (l, i, j) => (l * nx + i) * nz + j;
    const cellXZ = (i, j) => [x0 + (i + 0.5) * GR, (j + 0.5) * GR];
    const free = (l, i, j) => { const [x, z] = cellXZ(i, j); return !blocked(x, z, R, l); };
    const levelOf = (l, x, z) => (inStairs(x, z) ? (heightAt(x, z, l) > STOREY / 2 ? 1 : 0) : l);
    const prev = new Int32Array(2 * nx * nz).fill(-2);
    const q = [];
    const startCell = (() => { const t = { l: from.l, x: from.x, z: from.z }; const ci = Math.floor((t.x - x0) / GR), cj = Math.floor(t.z / GR); for (let r = 0; r <= 20; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= nx || j >= nz) continue; const [x, z] = cellXZ(i, j); if (!blocked(x, z, R, levelOf(t.l, x, z))) return [levelOf(t.l, x, z), i, j]; } return [t.l, ci, cj]; })();
    const [sl, si, sj] = startCell;
    prev[idx(sl, si, sj)] = -1; q.push([sl, si, sj]);
    // a room's middle may have a table or bed on it: aim for the nearest free spot instead
    const snap = (t) => {
      const ci = Math.floor((t.x - x0) / GR), cj = Math.floor(t.z / GR);
      for (let r = 0; r <= 20; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const [x, z] = cellXZ(i, j);
        if (!blocked(x, z, R, levelOf(t.l, x, z))) return idx(levelOf(t.l, x, z), i, j);
      }
      return idx(t.l, ci, cj);
    };
    const want = new Map(targets.map((t) => [snap(t), t]));
    let found = null;
    for (let h = 0; h < q.length && !found; h++) {
      const [l, i, j] = q[h];
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const p = i + a, r = j + b;
        if (p < 0 || r < 0 || p >= nx || r >= nz) continue;
        const [x, z] = cellXZ(p, r);
        const nl = levelOf(l, x, z);
        if (prev[idx(nl, p, r)] !== -2 || blocked(x, z, R, nl)) continue;
        prev[idx(nl, p, r)] = idx(l, i, j);
        q.push([nl, p, r]);
        if (want.has(idx(nl, p, r))) { found = idx(nl, p, r); break; }
      }
    }
    if (found === null) return null;
    const out = [];
    for (let c = found; c >= 0; c = prev[c]) { const j = c % nz, i = Math.floor(c / nz) % nx; out.push(cellXZ(i, j)); }
    out.reverse();
    // thin the path to every 2nd cell, keeping the corners
    const thin = out.filter((_, k) => k % 2 === 0 || k === out.length - 1);
    return { pts: thin, target: want.get(found), end: out[out.length - 1] };
  }
  /** One line a seller would say about a room, from what the plan really has (its size, windows, washroom, what it opens onto). */
  function sellingPoint(r, lay) {
    const onWall = (p) => (p.o === 'h' ? (Math.abs(p.c - r.z) < 0.06 || Math.abs(p.c - r.z - r.d) < 0.06) && p.at > r.x && p.at < r.x + r.w : (Math.abs(p.c - r.x) < 0.06 || Math.abs(p.c - r.x - r.w) < 0.06) && p.at > r.z && p.at < r.z + r.d);
    const wins = lay.openings.filter((p) => p.kind === 'window' && !p.bath && onWall(p));
    const sides = new Set(wins.map((p) => p.o + Math.round(p.c))).size, area = r.w * r.d;
    const toTerrace = lay.openings.some((p) => p.terrace && (p.room === r.id || p.to === r.id));
    switch (r.type) {
      case 'bed': return r.att ? (/master/i.test(r.name) ? 'Its own attached bathroom, a king bed and a full wardrobe wall' : 'Its own attached bathroom, so nobody shares') : sides >= 2 ? 'Windows on two sides: bright all day, with a cross breeze' : area >= 150 ? 'Room for a double bed, a wardrobe and a desk' : 'A quiet room set away from the lounge';
      case 'lounge': return toTerrace ? 'The family room, opening straight onto the terrace' : /dining/i.test(r.name) ? 'Sitting and dining in one open room: the heart of the home' : 'The family sits together here, in the middle of the house';
      case 'drawing': return r.att ? 'Guests are received here, with their own washroom, without entering the house' : 'A formal room for guests, right beside the entrance';
      case 'kitchen': return wins.length ? 'Daylight over the worktop, and counters along two walls' : 'A full run of counters with the cooker, sink and fridge in easy reach';
      case 'dining': return 'A table for six, next to the kitchen';
      case 'lobby': return 'A proper entrance that keeps the rooms out of sight of the door';
      case 'study': return 'A quiet desk for work or homework';
      case 'store': return 'Storage that keeps the rooms clear';
      default: return sides >= 2 ? 'Light from two sides' : 'Well placed in the plan';
    }
  }
  function startTour() {
    // the tour begins at the gate, with every door shut: the camera opens each one as it comes to it
    state.floor = 0; state.hs = 0; state.inS = false; state.onRoofDeck = false; state.pos.set(start, EYE, 2.5); state.yaw = Math.PI; state.pitch = 0;
    setAllDoors(false);
    planning = true;
    const stopOf = (r, lay, l) => ({ l, x: r.x + r.w / 2, z: r.z + r.d / 2, name: r.name, w: r.w, d: r.d, sqft: Math.round(r.w * r.d), point: sellingPoint(r, lay) });
    const rooms = [
      ...L.rooms.filter((r) => !r.parent && r.type !== 'stairs' && r.type !== 'passage').map((r) => stopOf(r, L, 0)),
      ...(U ? U.rooms.filter((r) => !r.parent && r.type !== 'stairs' && r.type !== 'passage').map((r) => stopOf(r, U, 1)) : []),
      ...(U ? (U.open || []).filter((o) => o.type === 'terrace' && o.w * o.d >= 40).map((o) => ({ l: 1, x: o.x + o.w / 2, z: o.z + o.d / 2, name: 'Terrace', w: o.w, d: o.d, sqft: Math.round(o.w * o.d), point: 'Open-air sitting space for cool evenings' })) : []),
    ];
    // a door-to-door route: nearest room first, ground floor before the first floor
    let cur = { l: 0, x: state.pos.x, z: state.pos.z };
    const todo = rooms.filter((r) => r.l === 0), up = rooms.filter((r) => r.l === 1);
    const route = [];
    let count = 0;
    for (const group of [todo, up]) {
      while (group.length) {
        const res = planPath(cur, group);
        if (!res) break;
        count++;
        route.push(...res.pts.map((p, k) => ({ x: p[0], z: p[1], stop: k === res.pts.length - 1 ? { ...res.target, i: count } : null })));
        cur = { l: res.target.l, x: res.end[0], z: res.end[1] };
        group.splice(group.indexOf(res.target), 1);
      }
    }
    planning = false;
    for (const pt of route) if (pt.stop) pt.stop.n = count;
    tour.path = route; tour.i = 0; tour.wait = 0; tour.pan = 1; tour.end = false;
    setMode('tour'); tour.on = route.length > 0;
    hooks.onFloor?.(0);
    hooks.onTour?.(tour.on);
  }
  function stopTour() { tour.on = false; if (state.mode === 'tour') setMode('walk'); hooks.onTour?.(false); }
  /** The end of the tour: the camera leaves the last room and rises to the dollhouse view of the whole home. */
  const rise = { t: 0, from: new THREE.Vector3(), q0: new THREE.Quaternion(), q1: new THREE.Quaternion(), to: null };
  function startRise() {
    tour.on = false;
    rise.t = 0; rise.from.copy(camera.position); rise.q0.copy(camera.quaternion);
    rise.to = dollPose();
    const m = new THREE.Matrix4().lookAt(rise.to.pos, rise.to.target, new THREE.Vector3(0, 1, 0)); rise.q1.setFromRotationMatrix(m);
    state.mode = 'rise'; orbit.enabled = false;
    camera.near = 0.6; camera.far = 2000; camera.updateProjectionMatrix();
    hooks.onTour?.(false, true);
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

  let raf, last = performance.now(), lastRoom = '', lightT = 0, lastNear = null, lastNearKey = '', fps = 60, slowT = 0;
  const head = new THREE.Vector3();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.mode === 'walk' && Math.abs(camera.fov - state.fov) > 0.02) { camera.fov += (state.fov - camera.fov) * Math.min(1, dt * 10); camera.updateProjectionMatrix(); }       // smooth zoom
    for (const d of doors) {                                       // doors swing and slide
      if (Math.abs(d.t - d.target) > 0.001) {
        d.t += (d.target - d.t) * Math.min(1, dt * 7);
        if (Math.abs(d.t - d.target) < 0.004) d.t = d.target;
        if (d.kind === 'swing') d.pivot.rotation.y = d.open * d.t; else d.slide.position[d.axis] = d.travel * d.t;
      }
    }
    if (state.mode === 'rise') { /* flown below */ }
    else if (MOVING.has(state.mode)) {
      const k = state.keys;
      let fwd = 0, str = 0, sp = 0;
      if (state.mode === 'tour' && tour.on) {
        for (const d of doors) if (d.target === 0 && Math.hypot(d.x - state.pos.x, d.z - state.pos.z) < 3.6 && (d.upper ? 1 : 0) === level()) d.target = 1;      // the guided visitor opens each door on the way
        const tgt = tour.path[tour.i];
        if (tour.wait > 0) { tour.wait -= dt; state.yaw += dt * 0.34 * tour.pan; state.pitch += (-0.1 - state.pitch) * Math.min(1, dt * 2); }      // a slow look round the room
        else if (tgt) {
          const dx = tgt.x - state.pos.x, dz = tgt.z - state.pos.z, dd = Math.hypot(dx, dz);
          const ahead = tour.path[Math.min(tour.path.length - 1, tour.i + 5)];                  // the camera looks a few steps along the way, so it turns before the corner, smoothly
          const want = Math.atan2(-(ahead.x - state.pos.x), -(ahead.z - state.pos.z));
          let dy = want - state.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          if (Math.hypot(ahead.x - state.pos.x, ahead.z - state.pos.z) > 0.6) state.yaw += dy * Math.min(1, dt * 2.6);
          state.pitch += (-0.04 - state.pitch) * Math.min(1, dt * 2);
          if (dd < 0.35) { if (tgt.stop) { tour.wait = 4.6; tour.pan = -tour.pan; hooks.onRoomStop?.(tgt.stop); } tour.i++; if (tour.i >= tour.path.length) tour.end = true; }
          else { const s = Math.min(dd, 3.7 * dt); const mx = (dx / dd) * s, mz = (dz / dd) * s; state.speed = s / dt; state.pos.x += mx; state.pos.z += mz; }
        }
        const h = settle();
        state.hs += (h - state.hs) * Math.min(1, dt * 12);
        if (tour.wait > 0) state.speed = 0;
        if (tour.end && tour.wait <= 0) { tour.end = false; startRise(); }
      } else {
        const run = k.has('shift') ? 2 : 1;
        const turn = ((k.has('arrowleft') || k.has('q')) ? 1 : 0) - ((k.has('arrowright') || k.has('e')) ? 1 : 0);
        state.yaw += turn * 1.8 * dt;
        fwd = ((k.has('w') || k.has('arrowup')) ? 1 : 0) - ((k.has('s') || k.has('arrowdown')) ? 1 : 0);
        str = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
        sp = 7 * run * dt;
        const fx = -Math.sin(state.yaw), fz = -Math.cos(state.yaw), rx = Math.cos(state.yaw), rz = -Math.sin(state.yaw);
        const dx = (fx * fwd + rx * str) * sp, dz = (fz * fwd + rz * str) * sp;
        const h = move(dx, dz);
        state.hs += (h - state.hs) * Math.min(1, dt * 12);
        state.speed = (fwd || str) ? 7 * run : 0;
      }
      state.pos.y = EYE + state.hs;
      // the person: feet on the floor, walking cycle while moving
      person.position.set(state.pos.x, state.hs, state.pos.z);
      person.rotation.y = state.yaw + Math.PI;
      state.phase += dt * state.speed * 1.7;
      person.walk(state.phase, Math.min(1, state.speed / 6));
      if (state.mode === 'rise') { /* the camera is flown below */ }
      else if (state.mode === 'walk' || state.mode === 'tour') {
        camera.position.copy(state.pos);
        camera.rotation.set(state.pitch, state.yaw, 0);
      } else {                                                     // third person: behind and above the visitor, pulled in by walls
        head.set(state.pos.x, state.hs + 4.6, state.pos.z);
        const bx = Math.sin(state.yaw), bz = Math.cos(state.yaw), lvl = level();
        let back = 8.5;
        const onS = state.inS;                                      // on the flight the rails are not walls: keep a gentle view from behind
        const camBlocked = (x, z) => (collLvl() === 2 ? roofColliders : lvl ? upperColliders : colliders).some((c) => x > c.x0 - 0.3 && x < c.x1 + 0.3 && z > c.z0 - 0.3 && z < c.z1 + 0.3 && solid(c) && !(onS && c.k === 'rail'));
        for (let t = 1.5; t <= 8.5; t += 0.5) { if (camBlocked(head.x + bx * t, head.z + bz * t)) { back = Math.max(onS ? 3.6 : 2.2, t - 0.8); break; } }
        const up = onS ? 2.4 + back * 0.15 + Math.max(0, 6 - back) * 0.7 + state.pitch * 3
          : 1.8 + back * 0.12 + Math.max(0, 6.5 - back) * 1.5 + state.pitch * 3;        // a wall behind: rise above it and look down
        camera.position.set(head.x + bx * back, head.y + up, head.z + bz * back);
        camera.lookAt(head.x, head.y - 0.4 + state.pitch * 1.5, head.z);
      }
      const mu = S.mumty, rn = onRoof() ? (mu && state.pos.x > mu.x0 && state.pos.x < mu.x1 && state.pos.z > mu.z0 && state.pos.z < mu.z1 ? 'Stair-head room' : inStairs(state.pos.x, state.pos.z) ? 'Stairs' : 'Roof') : roomAt(state.pos.x, state.pos.z);
      if (rn !== lastRoom) { lastRoom = rn; hooks.onRoom?.(rn); }
      if ((lightT += dt) > 0.2) {
        lightT = 0; placeLights();
        const nd = nearestDoor(4.5), key = nd ? `${nd.name}|${nd.upper}|${nd.target}` : '';
        if (key !== lastNearKey) { lastNear = nd; lastNearKey = key; hooks.onNearDoor?.(nd ? { open: !!nd.target, label: doorLabel(nd) } : null); }
      }
    } else orbit.update();
    if (state.mode === 'rise') {
      rise.t = Math.min(1, rise.t + dt / 4.2);
      const k = rise.t * rise.t * (3 - 2 * rise.t);
      camera.position.lerpVectors(rise.from, rise.to.pos, k); camera.position.y += Math.sin(k * Math.PI) * 6;
      camera.quaternion.slerpQuaternions(rise.q0, rise.q1, Math.min(1, k * 1.15));
      if (rise.t > 0.3 && roofG.visible) { roofG.visible = false; shadowDirty = true; }
      if (rise.t >= 1) setMode('doll');
    }
    // shadows: redrawn while a door is moving, while the visitor is shown walking, or after the sun, a look or the roof changed
    if (shadowDirty || state.mode === 'follow' || doors.some((d) => Math.abs(d.t - d.target) > 0.001)) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
    // a slow machine: draw fewer pixels first, then a smaller shadow map
    fps += ((1 / Math.max(dt, 0.001)) - fps) * 0.05;
    if ((slowT = fps < 27 ? slowT + dt : 0) > 3) {
      slowT = 0;
      if (pxRatio > 1) { pxRatio = Math.max(1, pxRatio - 0.5); renderer.setPixelRatio(pxRatio); resize(); }
      else if (S.sun.shadow.mapSize.x > 2048) { S.sun.shadow.mapSize.set(2048, 2048); S.sun.shadow.map?.dispose(); S.sun.shadow.map = null; shadowDirty = true; }
    }
    renderer.render(scene, camera);
  }
  build(false);
  setMode('walk');
  raf = requestAnimationFrame(loop);

  return {
    setMode, setRoof, resetWalk, setFloor, setCutaway, setFov, startTour, stopTour, setTime, setLook,
    get time() { return time; }, get look() { return look; },
    setColors: (c) => { curColors = { ...curColors, ...c }; S.setColors(c); },
    setFloors: (f) => { site = { ...site, ...(f.living ? { floorLiving: f.living } : {}), ...(f.bed ? { floorBed: f.bed } : {}) }; S.setFloors(f); },
    setSite: (s) => { site = { ...site, ...s }; build(true); },                       // a new boundary wall, gate or car: the scene is rebuilt
    toggleNearestDoor: () => { const d = nearestDoor(); if (d) toggleDoor(d); return d; },
    setAllDoors,
    get site() { return site; },
    get floor() { return level(); },
    get roofVisible() { return roofG.visible; },
    get mode() { return state.mode; },
    get fov() { return state.fov; },
    get cutaway() { return state.cutaway; },
    get touring() { return tour.on; },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('pointerup', onUp);
      amb.dispose(); orbit.dispose(); disposeScene(scene); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
