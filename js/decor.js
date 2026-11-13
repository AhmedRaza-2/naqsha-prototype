// What an interior designer adds once the furniture is in: curtains at the windows, pictures over the sofa and the beds,
// a laid dining table, books and a plant on the low units, a few things on the kitchen worktop and a pendant over the table.
// Everything is placed from the plan (rooms, openings) and the furniture pieces, in feet.
import * as THREE from 'three';
import { roleMat } from './furn3d.js';
import { artCanvas } from './interior.js';

const NO_CURTAIN = new Set(['bath', 'gbath', 'kitchen', 'stairs', 'store', 'passage', 'lobby']);
const eq = (a, b) => Math.abs(a - b) < 0.06;

/** -> { group, items, reg }: meshes made here, extra small models for furn3d.addFurniture, and what a new look must redraw. */
export function buildDecor(L, pieces, look) {
  const group = new THREE.Group(), items = [], reg = { art: [] };
  const mains = L.rooms.filter((r) => !r.parent);
  const roomAt = (x, z) => L.rooms.find((r) => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d && r.parent) || mains.find((r) => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d);
  const add = (geo, role, x, y, z, rx = 0, ry = 0, rz = 0, cast = true) => { const m = new THREE.Mesh(geo, typeof role === 'string' ? roleMat(role) : role); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = cast; m.receiveShadow = true; group.add(m); return m; };
  // a box along a wall line: s along the wall, off across it
  const along = (o, c, s0, s1, y0, y1, off, th, role) => (o === 'h'
    ? add(new THREE.BoxGeometry(s1 - s0, y1 - y0, th), role, (s0 + s1) / 2, (y0 + y1) / 2, c + off)
    : add(new THREE.BoxGeometry(th, y1 - y0, s1 - s0), role, c + off, (y0 + y1) / 2, (s0 + s1) / 2));

  // ---- curtains: a gathered panel each side of every window of a living room or bedroom, on a rod
  for (const p of L.openings) {
    if (p.kind !== 'window' || p.bath) continue;
    for (const dir of [1, -1]) {
      const px = p.o === 'h' ? p.at : p.c + dir * 0.6, pz = p.o === 'h' ? p.c + dir * 0.6 : p.at;
      const r = roomAt(px, pz);
      if (!r || NO_CURTAIN.has(r.type)) continue;
      const off = dir * 0.58, top = Math.min(9.5, p.top + 0.75), o0 = p.at - p.w / 2, o1 = p.at + p.w / 2;
      const lo = p.o === 'h' ? r.x + 0.3 : r.z + 0.3, hi = p.o === 'h' ? r.x + r.w - 0.3 : r.z + r.d - 0.3;
      along(p.o, p.c, Math.max(lo, o0 - 1.15), Math.min(hi, o1 + 1.15), top, top + 0.07, off, 0.07, 'rod');
      for (const [a, b] of [[o0 - 1.0, o0 - 0.05], [o1 + 0.05, o1 + 1.0]]) {
        const s0 = Math.max(lo, a), s1 = Math.min(hi, b), n = 4;
        if (s1 - s0 < 0.4) continue;
        for (let i = 0; i < n; i++) along(p.o, p.c, s0 + ((s1 - s0) * i) / n, s0 + ((s1 - s0) * (i + 1)) / n, 0.2, top, off + (i % 2 ? 0.035 : -0.035) * dir, 0.11, 'curtain');
      }
    }
  }

  // ---- pictures on the wall behind a sofa, a bed or a sideboard (never across a window or a door)
  let seed = 0;
  const ART = { sofa3: [[1.9, 2.4], [1.9, 2.4]], sofa2: [[2.8, 2.1]], bedKing: [[3.4, 1.9]], bedQueen: [[3, 1.8]], bedSingle: [[2, 1.5]], sideboard: [[2.4, 1.8]] };
  for (const it of pieces) {
    const set = ART[it.k], r = set && mains.find((q) => q.id === it.room);
    if (!r) continue;
    const o = it.fz !== 0 ? 'h' : 'v', dir = it.fz !== 0 ? it.fz : it.fx;                  // the wall is behind the piece; dir points into the room
    const wc = o === 'h' ? (dir > 0 ? r.z : r.z + r.d) : (dir > 0 ? r.x : r.x + r.w);
    const back = o === 'h' ? it.z - dir * it.d / 2 : it.x - dir * it.d / 2, mid = o === 'h' ? it.x : it.z;
    if (Math.abs(back - wc) > 0.95) continue;
    const total = set.reduce((a, [w]) => a + w, 0) + (set.length - 1) * 0.45;
    if (L.openings.some((p) => p.o === o && eq(p.c, wc) && Math.abs(p.at - mid) < (p.w + total) / 2 + 0.4)) continue;
    const beyond = o === 'h' ? roomAt(mid, wc - dir * 0.5) : roomAt(wc - dir * 0.5, mid);
    const face = wc + dir * ((beyond ? 0.2 : 0.42) + 0.03);                                   // the wall's inside face (an outside wall is thicker)
    const cy = /^bed/.test(it.k) ? 5.3 : it.k === 'sideboard' ? 5.5 : 5.7;
    let s = mid - total / 2;
    for (const [aw, ah] of set) {
      const tex = new THREE.CanvasTexture(artCanvas(look, aw, ah, ++seed)); tex.colorSpace = THREE.SRGBColorSpace;
      const pm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, envMapIntensity: 0.2 }); pm.userData.env0 = 0.2;
      const c = s + aw / 2, ry = o === 'h' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const fx = o === 'h' ? c : face + dir * 0.04, fz = o === 'h' ? face + dir * 0.04 : c;
      add(new THREE.BoxGeometry(aw + 0.2, ah + 0.2, 0.08), 'frame', fx, cy, fz, 0, ry, 0);
      const pic = add(new THREE.PlaneGeometry(aw, ah), pm, o === 'h' ? c : face + dir * 0.085, cy, o === 'h' ? face + dir * 0.085 : c, 0, ry, 0, false);
      reg.art.push({ mesh: pic, w: aw, h: ah, seed });
      s += aw + 0.45;
    }
  }

  // ---- small things on the furniture
  const fans = pieces.filter((i) => i.k === 'fan');
  const small = (k, host, dx, dz, w, d, h, y) => items.push({ k, key: `${host.key}|${k}`, x: host.x + dx, z: host.z + dz, fx: host.fx, fz: host.fz, w, d, h, y, room: host.room, soft: true, deco: true });
  const sideways = (it, t) => (it.fz !== 0 ? [t, 0] : [0, t]);                             // t feet along the piece's width
  let counters = 0;
  for (const it of pieces) {
    if (it.room === 'terrace') continue;
    if (/^table(Dining|Round)/.test(it.k)) {                       // a laid table: a plate and a glass at every chair, a vase in the middle
      const top = it.h + 0.02;
      for (const ch of pieces.filter((c) => c.k === 'chair' && c.room === it.room && Math.hypot(c.x - it.x, c.z - it.z) < 4.2)) {
        const dx = it.x - ch.x, dz = it.z - ch.z, dd = Math.hypot(dx, dz) || 1, ux = dx / dd, uz = dz / dd;
        const px = ch.x + ux * 1.5, pz = ch.z + uz * 1.5;
        add(new THREE.CylinderGeometry(0.4, 0.3, 0.05, 20), 'plate', px, top + 0.03, pz);
        add(new THREE.CylinderGeometry(0.09, 0.07, 0.3, 10), 'glassware', px - uz * 0.55 + ux * 0.2, top + 0.16, pz + ux * 0.55 + uz * 0.2, 0, 0, 0, false);
      }
      add(new THREE.CylinderGeometry(0.16, 0.22, 0.55, 14), 'pot', it.x, top + 0.28, it.z);
      add(new THREE.IcosahedronGeometry(0.42, 1), 'leaf', it.x, top + 0.85, it.z);
      if (!fans.some((f) => f.room === it.room && Math.hypot(f.x - it.x, f.z - it.z) < 3)) {      // a pendant lamp over the table, unless the fan hangs there
        add(new THREE.CylinderGeometry(0.02, 0.02, 2.9, 6), 'rod', it.x, 8.5, it.z, 0, 0, 0, false);
        add(new THREE.CylinderGeometry(0.28, 0.85, 0.75, 24, 1, true), 'shade', it.x, 6.75, it.z).material.side = THREE.DoubleSide;
      }
    } else if (it.k === 'coffeeTable') {
      const [ax, az] = sideways(it, 0.8);
      small('books', it, -ax, -az, 0.9, 0.7, 0.3, it.h + 0.02);
      add(new THREE.CylinderGeometry(0.42, 0.24, 0.22, 18), 'pot', it.x + ax, it.h + 0.13, it.z + az);
      for (const [a, b] of [[0.12, 0.05], [-0.14, 0.1], [0.02, -0.15]]) add(new THREE.IcosahedronGeometry(0.15, 1), 'fruit', it.x + ax + a, it.h + 0.3, it.z + az + b, 0, 0, 0, false);
    } else if (it.k === 'tvUnit' || it.k === 'sideboard') {
      const [ax, az] = sideways(it, it.w / 2 - 0.5);
      small('plantSmall', it, ax, az, 0.75, 0.75, 1.2, it.h + 0.02);
      if (it.k === 'sideboard') small('books', it, -ax, -az, 0.9, 0.7, 0.3, it.h + 0.02);
    } else if (it.k === 'kcounter' && it.w >= 1.6) {                 // the worktop: a coffee machine, a bowl of fruit, a blender
      const bx = -it.fx * 0.35, bz = -it.fz * 0.35, n = counters++;
      if (n === 0) small('coffeeMachine', it, bx, bz, 0.9, 0.9, 1.2, 3.02);
      else if (n === 2) small('blender', it, bx, bz, 0.6, 0.6, 1.2, 3.02);
      else if (n === 1) {
        add(new THREE.CylinderGeometry(0.5, 0.3, 0.25, 18), 'plate', it.x, 3.16, it.z);
        for (const [a, b] of [[0.15, 0.05], [-0.16, 0.1], [0, -0.17], [0.02, 0.02]]) add(new THREE.IcosahedronGeometry(0.17, 1), 'fruit', it.x + a, 3.36, it.z + b, 0, 0, 0, false);
      }
    }
  }
  return { group, items, reg };
}

/** Redraw the pictures in a new look's colours. */
export function restyleDecor(reg, look) {
  for (const a of reg.art) { const t = new THREE.CanvasTexture(artCanvas(look, a.w, a.h, a.seed)); t.colorSpace = THREE.SRGBColorSpace; a.mesh.material.map.dispose(); a.mesh.material.map = t; a.mesh.material.needsUpdate = true; }
}
