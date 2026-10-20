// 3D furniture: turns the pieces chosen by furniture.js into models. The models are the free "Furniture Kit" by Kenney
// (CC0, assets/furniture/License.txt); each is fitted to the real-world size of the piece (feet), stood on the floor
// and turned to face the way the plan says.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
  plant: 'pottedPlant', floorLamp: 'lampRoundFloor', coat: 'coatRack', fan: 'ceilingFan', rug: 'rugRectangle', mat: 'rugDoormat', pot: 'pottedPlant',
};
// models whose front is not +Z, or whose shape needs a different fitting
const OPTS = { rug: { flat: true }, mat: { flat: true }, fan: { keepRatio: true }, plant: { keepRatio: true }, floorLamp: { keepRatio: true }, lampTable: { keepRatio: true }, laptop: { keepRatio: true }, pot: { keepRatio: true } };

// The kit is painted in bright toy colours; every material is named (wood, carpet, metal ...), so each piece is
// repainted with a calmer palette: walnut wood, linen and fabric in colours that suit the piece.
const WOOD = '#9b7652', WOOD_DARK = '#6b4c34';
const FABRIC = { bedKing: '#d8d2c4', bedQueen: '#d8d2c4', bedSingle: '#c9d2dc', sofa3: '#6f7f8b', sofa2: '#8d7b69', armchair: '#8d7b69', chair: '#7a6551', deskChair: '#3d4046', rug: '#bfae94', mat: '#6f8b73', tv: '#222', default: '#b9a68c' };
const mix = (hex, to, t) => new THREE.Color(hex).lerp(new THREE.Color(to), t);
const paint = new Map();
function repaint(mat, k) {
  const key = `${mat.name}|${k}`;
  if (paint.has(key)) return paint.get(key);
  let c = null;
  const f = FABRIC[k] || FABRIC.default;
  if (mat.name === 'wood') c = new THREE.Color(WOOD);
  else if (mat.name === 'woodDark') c = new THREE.Color(WOOD_DARK);
  else if (mat.name === 'carpet') c = new THREE.Color(f);
  else if (mat.name === 'carpetDarker') c = mix(f, '#000000', 0.28);
  else if (mat.name === 'carpetBlue') c = mix(f, '#7f93a8', 0.7);
  else if (mat.name === 'carpetWhite') c = new THREE.Color(k === 'bedKing' || k === 'bedQueen' || k === 'bedSingle' ? '#f4f1ea' : '#efeae0');
  else if (mat.name === 'plant') c = new THREE.Color('#4d8a3a');
  const m = mat.clone();
  if (c) m.color.copy(c);
  m.roughness = mat.name.startsWith('metal') ? 0.45 : 0.85;
  m.metalness = mat.name.startsWith('metal') ? 0.35 : 0;
  if (mat.name === 'glass') { m.transparent = true; m.opacity = 0.55; }
  paint.set(key, m);
  return m;
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

/** Add every piece to `parent` (a group sitting at the height of its floor). Resolves when the models are in. */
export async function addFurniture(parent, items) {
  const alt = {};
  await Promise.all(items.map(async (it) => {
    let f = MODEL[it.k];
    if (!f) return;
    if (Array.isArray(f)) { alt[it.k] = (alt[it.k] || 0) + 1; f = f[alt[it.k] % f.length]; }
    const m = await load(f);
    if (!m) return;
    const o = OPTS[it.k] || {};
    const obj = m.scene.clone(true);
    obj.traverse((n) => { if (n.isMesh) n.material = Array.isArray(n.material) ? n.material.map((x) => repaint(x, it.k)) : repaint(n.material, it.k); });
    let sx = it.w / m.size.x, sz = it.d / m.size.z, sy = it.h / m.size.y;
    if (o.keepRatio) { sx = sz = Math.min(sx, sz); sy = sx; }
    else if (o.flat) sy = 1;
    else { const g = Math.sqrt(sx * sz); sy = Math.max(g * 0.75, Math.min(g * 1.4, sy)); }
    const holder = new THREE.Group();
    obj.scale.set(sx, sy, sz);
    obj.position.set(-m.centre.x * sx, -m.min.y * sy, -m.centre.z * sz);   // centred on the footprint, standing on y = 0
    holder.add(obj);
    holder.rotation.y = Math.atan2(it.fx, it.fz);                          // the models face +Z
    holder.position.set(it.x, it.y + (o.flat ? 0.085 : 0.065), it.z);   // clear of the floor plane (0.03, 0.05 in a bath / dressing room): no flicker where they touch
    parent.add(holder);
  }));
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
