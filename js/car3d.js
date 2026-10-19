// A parked car for the plot: the free "Car Kit" by Kenney (CC0, assets/cars/License.txt), fitted to real size in feet.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const DIR = new URL('../assets/cars/', import.meta.url);
const loader = new GLTFLoader();
loader.setDRACOLoader(new DRACOLoader().setDecoderPath(new URL('../vendor/three/addons/libs/draco/gltf/', import.meta.url).href));      // for the sports car (compressed)
const cache = new Map();
// real sizes (ft): length, width, height
export const CARS = {
  sedan: { file: 'sedan', l: 15, w: 5.9, h: 4.7 },
  hatchback: { file: 'hatchback-sports', l: 13.2, w: 5.8, h: 4.5 },
  suv: { file: 'suv', l: 15.6, w: 6.3, h: 5.6 },
  luxury: { file: 'suv-luxury', l: 16.2, w: 6.4, h: 5.7 },
  // popular models: the closest body in the kit, at the real length, width and height of the car
  lc300: { file: 'suv', l: 16.4, w: 6.5, h: 6.3 },
  corolla: { file: 'sedan', l: 15.2, w: 5.85, h: 4.7 },
  cultus: { file: 'hatchback-sports', l: 11.8, w: 4.85, h: 5.1 },
  swift: { file: 'hatchback-sports', l: 12.6, w: 5.7, h: 4.9 },
  // a sports car from the three.js examples (Ferrari 458 Italia by vicent091036, CC-BY 4.0, see assets/cars/License.txt): its own paint, real size
  ferrari: { file: 'ferrari', l: 14.85, w: 6.5, h: 3.9, paint: true, flip: true },
  mercedesc: { file: 'sedan-sports', l: 15.6, w: 6.0, h: 4.7 },
  mercedesgle: { file: 'suv-luxury', l: 16.2, w: 6.6, h: 5.8 },
};

// paint colours (the kit paints each car in one patch of its colour map; that patch is swapped for these)
export const CAR_COLORS = { white: [236, 236, 238], silver: [178, 184, 190], black: [38, 40, 46], graphite: [86, 92, 100], maroon: [122, 38, 46], navy: [38, 62, 104], red: [196, 44, 44] };

/** The car's body colour: the colour patch that covers most of its surface (not the dark tyres, grey glass or lights). */
function bodyPatch(mesh, data, size) {
  const g = mesh.geometry, uv = g.attributes.uv, pos = g.attributes.position, idx = g.index;
  if (!uv || !pos) return null;
  const hist = new Map();
  const tri = (a, b, c) => {
    const A = new THREE.Vector3().fromBufferAttribute(pos, a), Bv = new THREE.Vector3().fromBufferAttribute(pos, b), C = new THREE.Vector3().fromBufferAttribute(pos, c);
    const area = Bv.clone().sub(A).cross(C.clone().sub(A)).length();
    const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3, v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
    const px = Math.min(size - 1, Math.max(0, Math.floor(u * size))), py = Math.min(size - 1, Math.max(0, Math.floor(v * size)));
    const o = (py * size + px) * 4, r = data[o], gg = data[o + 1], bl = data[o + 2];
    const sat = Math.max(r, gg, bl) - Math.min(r, gg, bl);
    if (sat < 45 || Math.max(r, gg, bl) < 90) return;
    const k = `${r},${gg},${bl}`;
    hist.set(k, (hist.get(k) || 0) + area);
  };
  if (idx) for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)); else for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
  let best = null, bv = 0;
  for (const [k, v] of hist) if (v > bv) { bv = v; best = k.split(',').map(Number); }
  return best;
}

/** A car facing +Z (nose toward +z), standing on y = 0, centred on its footprint. Resolves to null if the model is missing. */
export async function loadCar(kind = 'sedan', color = null) {
  const spec = CARS[kind] || CARS.sedan;
  if (!cache.has(spec.file)) cache.set(spec.file, loader.loadAsync(new URL(`${spec.file}.glb`, DIR).href).catch(() => null));
  const g = await cache.get(spec.file);
  if (!g) return null;
  const obj = g.scene.clone(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  // the kit's cars are longest along z; turn the model if it is longest along x
  const turn = size.x > size.z;
  const [sx, sy, sz] = turn ? [spec.l / size.x, spec.h / size.y, spec.w / size.z] : [spec.w / size.x, spec.h / size.y, spec.l / size.z];
  const holder = new THREE.Group(), inner = new THREE.Group();
  obj.scale.set(sx, sy, sz);
  obj.position.set(-c.x * sx, -box.min.y * sy, -c.z * sz);
  inner.add(obj);
  if (turn) inner.rotation.y = Math.PI / 2;
  if (spec.flip) inner.rotation.y += Math.PI;                       // this model's nose points the other way
  holder.add(inner);
  let recoloured = null;
  if (spec.paint) {                                                 // this car's body paint is a plain material colour
    const c = CAR_COLORS[color] || CAR_COLORS.red;
    holder.traverse((o) => { if (o.isMesh && o.material && /body/i.test(o.material.name)) { o.material = o.material.clone(); o.material.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255); } });
  } else if (color && CAR_COLORS[color]) {                                 // swap the body's colour patch in a copy of the colour map
    const meshes = []; holder.traverse((o) => o.isMesh && meshes.push(o));
    const m0 = meshes[0] && meshes[0].material, img = m0 && m0.map && m0.map.image;
    if (img && img.width) {
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
      const data = cx.getImageData(0, 0, cv.width, cv.height);
      let patch = null; for (const me of meshes) { patch = bodyPatch(me, data.data, cv.width) || patch; if (patch) break; }
      if (patch) {
        const to = CAR_COLORS[color];
        for (let i = 0; i < data.data.length; i += 4) if (Math.abs(data.data[i] - patch[0]) < 3 && Math.abs(data.data[i + 1] - patch[1]) < 3 && Math.abs(data.data[i + 2] - patch[2]) < 3) { data.data[i] = to[0]; data.data[i + 1] = to[1]; data.data[i + 2] = to[2]; }
        cx.putImageData(data, 0, 0);
        recoloured = new THREE.CanvasTexture(cv); recoloured.flipY = false; recoloured.colorSpace = THREE.SRGBColorSpace; recoloured.magFilter = THREE.NearestFilter;
      }
    }
  }
  holder.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const m = o.material.clone();
    m.roughness = 0.4; m.metalness = Math.max(m.metalness || 0, 0.3); m.envMapIntensity = 1.15;
    if (recoloured) m.map = recoloured;
    o.material = m;
  });
  return holder;
}
