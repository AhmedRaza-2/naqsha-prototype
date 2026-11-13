// 3D furniture: turns the pieces chosen by furniture.js into models. The models are the free "Furniture Kit" by Kenney
// (CC0, assets/furniture/License.txt); each is fitted to the real-world size of the piece (feet), stood on the floor
// and turned to face the way the plan says. Every piece is repainted in the colours of the interior look (interior.js),
// beds and sofas are dressed (a throw, cushions), and rugs are woven from a drawn pattern.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LOOKS, rugCanvas } from './interior.js';

const DIR = new URL('../assets/furniture/', import.meta.url);
// plan piece -> model file (alternates are used in turn so a row of counters is not one repeated copy)
const MODEL = {
  bedKing: 'bedDouble', bedQueen: 'bedDouble', bedSingle: 'bedSingle', bedside: 'cabinetBedDrawerTable', lampTable: 'lampRoundTable',
  wardrobe: 'bookcaseClosedWide', wardrobeSmall: 'bookcaseClosed', tvUnit: 'cabinetTelevision', tv: 'televisionModern',
  sofa3: 'loungeSofa', sofa2: 'loungeDesignSofa', armchair: 'loungeChair', coffeeTable: 'tableCoffee', sideTable: 'sideTable',
  tableDining6: 'table', tableDining4: 'table', tableRound: 'tableRound', chair: 'chairCushion', sideboard: 'cabinetTelevisionDoors',
  desk: 'desk', deskChair: 'chairDesk', bookcase: 'bookcaseOpen', laptop: 'laptop',
  kcounter: ['kitchenCabinet', 'kitchenCabinetDrawer'], sink: 'kitchenSink', stove: 'kitchenStoveElectric', fridge: 'kitchenFridgeLarge',
  hood: 'hoodLarge', kupper: 'kitchenCabinetUpper',
  toilet: 'toilet', basin: 'bathroomSink', shower: 'shower', bathtub: 'bathtub', mirror: 'bathroomMirror',
  plant: 'pottedPlant', floorLamp: 'lampRoundFloor', coat: 'coatRack', fan: 'ceilingFan', mat: 'rugDoormat', pot: 'pottedPlant',
  // small things a designer adds (decor.js)
  books: 'books', plantSmall: ['plantSmall1', 'plantSmall2'], coffeeMachine: 'kitchenCoffeeMachine', blender: 'kitchenBlender', microwave: 'kitchenMicrowave',
};
// models whose front is not +Z, or whose shape needs a different fitting
const KEEP = { keepRatio: true };
const OPTS = { mat: { flat: true }, fan: KEEP, plant: KEEP, floorLamp: KEEP, lampTable: KEEP, laptop: KEEP, pot: KEEP, books: KEEP, plantSmall: KEEP, coffeeMachine: KEEP, blender: KEEP, microwave: KEEP };

// The kit is painted in bright toy colours; every material is named (wood, carpet, metal ...), so each piece is
// repainted from the interior look: its wood, its fabric for that kind of piece, its stone for the kitchen worktops.
let look = LOOKS.modern, lampGlow = 0.12;
const FABRIC_OF = { bedKing: 'bed', bedQueen: 'bed', bedSingle: 'bed', sofa3: 'sofa', sofa2: 'sofa', armchair: 'armchair', chair: 'chair', deskChair: 'deskChair' };
const WORKTOP = new Set(['kcounter', 'sink']), LAMPS = new Set(['lampTable', 'floorLamp']);
const mix = (hex, to, t) => new THREE.Color(hex).lerp(new THREE.Color(to), t);
const painted = new Map();                                       // `${material name}|${piece}` -> { m, name, k }
function colourFor(name, k) {
  const f = look.fabric[FABRIC_OF[k]] || (k === 'mat' ? '#6f8b73' : k === 'tv' ? '#222222' : look.fabric.default);
  if (name === 'wood') return new THREE.Color(look.wood);
  if (name === 'woodDark') return new THREE.Color(k === 'plant' || k === 'pot' || k === 'plantSmall' ? look.plantPot : look.woodDark);
  if (name === 'carpet') return new THREE.Color(f);
  if (name === 'carpetDarker') return mix(f, '#000000', 0.28);
  if (name === 'carpetBlue') return mix(f, look.cushion[0], 0.6);
  if (name === 'carpetWhite') return new THREE.Color(look.linen);
  if (name === 'plant') return new THREE.Color('#4d8a3a');
  if (name === 'lamp') return new THREE.Color(look.lampShade);
  if (name === 'metal' && WORKTOP.has(k)) return new THREE.Color(look.counter);
  if (name === 'metal' && LAMPS.has(k)) return new THREE.Color(look.metal);
  return null;
}
function applyPaint(e) {
  const { m, name, k } = e, c = colourFor(name, k);
  if (c) m.color.copy(c); else if (e.base) m.color.copy(e.base);
  const metal = name.startsWith('metal'), top = name === 'metal' && WORKTOP.has(k);
  m.roughness = top ? 0.28 : metal ? 0.45 : name.startsWith('wood') ? 0.62 : 0.88;
  m.metalness = top ? 0.05 : metal ? 0.35 : 0;
  m.envMapIntensity = top ? 0.9 : name.startsWith('wood') ? 0.5 : 0.35; m.userData.env0 = m.envMapIntensity;
  if (name === 'glass') { m.transparent = true; m.opacity = 0.55; }
  if (name === 'lamp') { m.emissive = new THREE.Color(k === 'fan' ? '#fff1d6' : look.lampShade).multiplyScalar(0.9); m.emissiveIntensity = lampGlow; }
}
function repaint(mat, k) {
  const key = `${mat.name}|${k}`;
  if (!painted.has(key)) { const e = { m: mat.clone(), name: mat.name, k, base: mat.color.clone() }; applyPaint(e); painted.set(key, e); }
  return painted.get(key).m;
}

// materials for the things made here and in decor.js (throws, cushions, curtains, frames ...): one per role, recoloured when the look changes
const ROLE = {
  throw: (l) => l.throw, cushion0: (l) => l.cushion[0], cushion1: (l) => l.cushion[1], cushion2: (l) => l.cushion[2], curtain: (l) => l.curtain, rod: (l) => l.rod,
  linen: (l) => l.linen, metal: (l) => l.metal, counter: (l) => l.counter, pot: (l) => l.plantPot, frame: (l) => l.art.frame, wood: (l) => l.wood, woodDark: (l) => l.woodDark,
  plate: () => '#f7f5f0', glassware: () => '#dfeaee', leaf: () => '#4d8a3a', fruit: () => '#d98a3a', shade: (l) => l.lampShade,
};
const SOFT = new Set(['throw', 'cushion0', 'cushion1', 'cushion2', 'curtain', 'linen']);
const roles = new Map();
export function roleMat(role) {
  if (!roles.has(role)) {
    const metal = role === 'rod' || role === 'metal';
    const m = new THREE.MeshStandardMaterial({ color: ROLE[role](look), roughness: SOFT.has(role) ? 0.95 : metal ? 0.4 : role === 'plate' || role === 'counter' ? 0.3 : 0.7, metalness: metal ? 0.55 : 0, envMapIntensity: metal ? 0.9 : 0.35 });
    if (role === 'glassware') { m.transparent = true; m.opacity = 0.5; m.roughness = 0.05; }
    if (role === 'shade') { m.emissive = new THREE.Color(look.lampShade).multiplyScalar(0.9); m.emissiveIntensity = lampGlow; }
    m.userData.env0 = m.envMapIntensity;
    roles.set(role, m);
  }
  return roles.get(role);
}

/** Every material the furniture is painted with (for the lighting: reflections fade at night). */
export const furnitureMaterials = () => [...[...painted.values()].map((e) => e.m), ...roles.values()];

/** Change the interior look: every piece already in the house is repainted, and new ones are painted that way. */
export function setFurnitureLook(l) {
  look = l;
  for (const e of painted.values()) applyPaint(e);
  for (const [role, m] of roles) { m.color.set(ROLE[role](look)); if (role === 'shade') m.emissive.set(look.lampShade).multiplyScalar(0.9); }
}
/** How brightly the lamps shine (0.1 by day, up to about 2 at night). */
export function setLampGlow(v) {
  lampGlow = v;
  for (const e of painted.values()) if (e.name === 'lamp') e.m.emissiveIntensity = v;
  if (roles.has('shade')) roles.get('shade').emissiveIntensity = v;
}

const loader = new GLTFLoader();
const cache = new Map();                                         // file -> Promise<{ scene, size, centre, min }>
function load(file) {
  if (!cache.has(file)) {
    cache.set(file, loader.loadAsync(new URL(`${file}.glb`, DIR).href).then((g) => {
      const box = new THREE.Box3().setFromObject(g.scene);
      const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return { scene: g.scene, size, centre, min: box.min.clone() };
    }).catch(() => null));
  }
  return cache.get(file);
}

const soft = (g, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = o.receiveShadow = true; return o; };
/** The top of a piece's upholstery inside a region of its footprint (local feet: x across, z towards the front), or null. */
function fabricTop(obj, test) {
  let top = -Infinity; const v = new THREE.Vector3();
  obj.updateMatrixWorld(true);
  obj.traverse((n) => {
    if (!n.isMesh || !/^carpet/.test(n.userData.paintName || '')) return;
    const p = n.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld); if (test(v.x, v.z) && v.y > top) top = v.y; }
  });
  return Number.isFinite(top) ? top : null;
}
/** A made bed (a throw across the foot, two cushions against the pillows) and a sofa with cushions: the things that make a room look lived in. */
function dress(holder, it, obj) {
  const { w, d } = it;
  if (/^bed/.test(it.k)) {
    const top = fabricTop(obj, (x, z) => z > d * 0.1 && Math.abs(x) < w * 0.56);
    if (top == null) return;
    const tw = w + 0.12, td = d * 0.24, tz = d * 0.27;
    holder.add(soft(new THREE.BoxGeometry(tw, 0.09, td), roleMat('throw'), 0, top + 0.05, tz));
    for (const sd of [-1, 1]) holder.add(soft(new THREE.BoxGeometry(0.07, 0.75, td), roleMat('throw'), sd * (tw / 2), top - 0.3, tz));       // it hangs over the sides
    if (it.k !== 'bedSingle') for (const [sd, role] of [[-1, 'cushion0'], [1, 'cushion1']]) holder.add(soft(new THREE.BoxGeometry(1.45, 1, 0.34), roleMat(role), sd * w * 0.2, top + 0.55, -d * 0.5 + 2.15, -0.42, sd * 0.08, 0));
    else holder.add(soft(new THREE.BoxGeometry(1.3, 0.9, 0.32), roleMat('cushion0'), 0, top + 0.5, -d * 0.5 + 2.05, -0.42, 0, 0));
  } else if (it.k === 'sofa3' || it.k === 'sofa2') {
    const seat = fabricTop(obj, (x, z) => z > d * 0.2 && Math.abs(x) < w * 0.3) ?? it.h * 0.46;
    const xs = it.k === 'sofa3' ? [[-1, 'cushion0'], [1, 'cushion1'], [0.42, 'cushion2']] : [[-1, 'cushion0'], [1, 'cushion2']];
    for (const [sd, role] of xs) holder.add(soft(new THREE.BoxGeometry(1.15, 1.05, 0.32), roleMat(role), sd * (w / 2 - 1.45), seat + 0.52, -d * 0.04, -0.28, 0, 0));
  }
}

/** A rug woven from the look's pattern: a thin slab with the drawing on top. `reg.rugs` remembers it so a new look can reweave it. */
function weave(it, reg) {
  const tex = new THREE.CanvasTexture(rugCanvas(look, it.w, it.d));
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, envMapIntensity: 0.15 }); m.userData.env0 = 0.15;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(it.w, 0.07, it.d), m);
  mesh.position.y = 0.035; mesh.receiveShadow = true;
  reg?.rugs.push({ mesh, w: it.w, d: it.d });
  return mesh;
}

/** Add every piece to `parent` (a group sitting at the height of its floor). Resolves when the models are in.
 *  reg: { rugs: [] } collects what a change of look must redraw (see restyle). */
export async function addFurniture(parent, items, reg = null) {
  const alt = {};
  await Promise.all(items.map(async (it) => {
    const holder = new THREE.Group();
    if (it.k === 'rug') holder.add(weave(it, reg));
    else {
      let f = MODEL[it.k];
      if (!f) return;
      if (Array.isArray(f)) { alt[it.k] = (alt[it.k] || 0) + 1; f = f[alt[it.k] % f.length]; }
      const m = await load(f);
      if (!m) return;
      const o = OPTS[it.k] || {};
      const obj = m.scene.clone(true);
      obj.traverse((n) => { if (n.isMesh) { n.userData.paintName = Array.isArray(n.material) ? n.material[0].name : n.material.name; n.material = Array.isArray(n.material) ? n.material.map((x) => repaint(x, it.k)) : repaint(n.material, it.k); } });
      let sx = it.w / m.size.x, sz = it.d / m.size.z, sy = it.h / m.size.y;
      if (o.keepRatio) { sx = sz = Math.min(sx, sz); sy = sx; }
      else if (o.flat) sy = 1;
      else { const g = Math.sqrt(sx * sz); sy = Math.max(g * 0.75, Math.min(g * 1.4, sy)); }
      obj.scale.set(sx, sy, sz);
      obj.position.set(-m.centre.x * sx, -m.min.y * sy, -m.centre.z * sz);   // centred on the footprint, standing on y = 0
      holder.add(obj);
      try { dress(holder, it, obj); } catch { /* a piece without upholstery stays as it is */ }
    }
    holder.rotation.y = Math.atan2(it.fx, it.fz);                          // the models face +Z
    holder.position.set(it.x, it.y + (it.k === 'rug' || (OPTS[it.k] || {}).flat ? 0.085 : 0.065), it.z);   // clear of the floor plane (0.03, 0.05 in a bath / dressing room): no flicker where they touch
    parent.add(holder);
  }));
}

/** Redraw what was woven or drawn for the old look (the rugs). */
export function restyle(reg) {
  for (const r of reg.rugs) { const t = new THREE.CanvasTexture(rugCanvas(look, r.w, r.d)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; r.mesh.material.map.dispose(); r.mesh.material.map = t; r.mesh.material.needsUpdate = true; }
}

const WALL_MOUNTED = new Set(['kupper', 'hood', 'mirror', 'coat']);       // hang at head height: a visitor must not walk into them
const SMALL = new Set(['chair', 'deskChair']);

/** Footprints a visitor cannot walk through: solid furniture, chairs, and anything hung at head height. */
export function furnitureColliders(items) {
  return items.filter((i) => ((!i.soft && !i.deco) || WALL_MOUNTED.has(i.k) || SMALL.has(i.k)) && i.k !== 'fan' && i.k !== 'rug' && i.k !== 'mat')
    .map((i) => {
      let [ex, ez] = i.fz !== 0 ? [i.w, i.d] : [i.d, i.w];
      if (SMALL.has(i.k)) { ex = Math.min(ex, 1.2); ez = Math.min(ez, 1.2); }
      return { x0: i.x - ex / 2, x1: i.x + ex / 2, z0: i.z - ez / 2, z1: i.z + ez / 2, k: i.k, room: i.room };
    });
}
