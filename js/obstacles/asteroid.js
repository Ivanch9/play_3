import * as THREE from 'three';
import { fbm3, rand, pick } from '../util.js';
import { Q } from '../quality.js';

// ---------- Процедурная геометрия астероидов ----------
function makeRockGeo(seed, kind) {
  const g = new THREE.IcosahedronGeometry(1, Q.astDetail);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const craters = [];
  const nCr = 4 + Math.floor(Math.random() * 6);
  for (let i = 0; i < nCr; i++) {
    craters.push({
      c: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
      r: rand(0.18, 0.45),
      d: rand(0.08, 0.2),
    });
  }
  const stretch = new THREE.Vector3(rand(0.75, 1.3), rand(0.65, 1.0), rand(0.8, 1.35));
  const base = kind === 'ice'
    ? new THREE.Color(0.75, 0.85, 0.95)
    : kind === 'metal' ? new THREE.Color(0.45, 0.42, 0.4) : new THREE.Color(0.42, 0.36, 0.31);

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1 + 0.32 * fbm3(v.x * 1.5 + seed, v.y * 1.5, v.z * 1.5, 4) + 0.06 * fbm3(v.x * 6 + seed, v.y * 6, v.z * 6, 2);
    let shade = 1;
    for (const cr of craters) {
      const d = 1 - v.dot(cr.c);
      if (d < cr.r) {
        const k = d / cr.r;
        r -= cr.d * (1 - k * k);            // чаша
        if (k > 0.75) r += cr.d * 0.35 * (k - 0.75) * 4 * (1 - k) * 4; // вал
        shade *= 0.7 + 0.3 * k;
      }
    }
    const p = v.clone().multiplyScalar(r).multiply(stretch);
    pos.setXYZ(i, p.x, p.y, p.z);
    const n = 0.85 + 0.25 * fbm3(v.x * 3 - seed, v.y * 3, v.z * 3, 3);
    colors[i * 3] = base.r * shade * n;
    colors[i * 3 + 1] = base.g * shade * n;
    colors[i * 3 + 2] = base.b * shade * n;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

let ROCK_GEOS = null;
const MATS = {};
function initShared() {
  if (ROCK_GEOS) return;
  ROCK_GEOS = { rock: [], ice: [], metal: [] };
  for (let i = 0; i < 7; i++) ROCK_GEOS.rock.push(makeRockGeo(i * 17.3, 'rock'));
  for (let i = 0; i < 3; i++) ROCK_GEOS.ice.push(makeRockGeo(100 + i * 11.1, 'ice'));
  for (let i = 0; i < 3; i++) ROCK_GEOS.metal.push(makeRockGeo(200 + i * 7.7, 'metal'));
  MATS.rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02, flatShading: true });
  MATS.ice = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1, flatShading: true, emissive: 0x0a1a2a });
  MATS.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.75, flatShading: true });
}

export class Asteroid {
  constructor() {
    initShared();
    this.kind = 'asteroid';
    this.giant = false;
    this.mesh = new THREE.Mesh(ROCK_GEOS.rock[0], MATS.rock);
    this.group = this.mesh;
    this.group.visible = false;
    this.active = false;
    this.spin = new THREE.Vector3();
    this.drift = new THREE.Vector3();
  }

  reset({ x, y, z, r, collidable = true }) {
    const t = Math.random();
    const type = t < 0.7 ? 'rock' : t < 0.85 ? 'ice' : 'metal';
    this.mesh.geometry = pick(ROCK_GEOS[type]);
    this.mesh.material = MATS[type];
    this.mesh.position.set(x, y, z);
    this.mesh.scale.setScalar(r);
    this.mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    this.spin.set(rand(-1.5, 1.5), rand(-1.5, 1.5), rand(-1.5, 1.5));
    this.drift.set(rand(-0.25, 0.25), rand(-0.2, 0.2), 0);
    this.r = r;
    this.hitR = r * 0.8;
    this.extent = r * 1.5;
    this.collidable = collidable;
    this.active = true;
    this.group.visible = true;
  }

  update(dt, dz) {
    const m = this.mesh;
    m.position.z += dz;
    m.position.x += this.drift.x * dt;
    m.position.y += this.drift.y * dt;
    m.rotation.x += this.spin.x * dt;
    m.rotation.y += this.spin.y * dt;
    m.rotation.z += this.spin.z * dt;
  }

  hitTest(sp, z, shipR) {
    if (!this.collidable) return null;
    const p = this.mesh.position;
    const dx = sp.x - p.x, dy = sp.y - p.y, dzz = sp.z - z;
    const R = this.hitR + shipR;
    return dx * dx + dy * dy + dzz * dzz < R * R ? 'asteroid' : null;
  }

  deactivate() { this.active = false; this.group.visible = false; }
}

// ---------- Космический мусор: обломки станций, панели, баки ----------
const DEBRIS_MATS = () => ({
  metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.85, roughness: 0.35 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc89a3a, metalness: 1.0, roughness: 0.3 }),
  solar: new THREE.MeshStandardMaterial({ color: 0x14245a, metalness: 0.7, roughness: 0.2, emissive: 0x040a22 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2c2f36, metalness: 0.5, roughness: 0.6 }),
  warn: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.25, 0.1) }),
});
let DM = null;

export class Debris {
  constructor() {
    if (!DM) DM = DEBRIS_MATS();
    this.kind = 'debris';
    this.giant = false;
    this.group = new THREE.Group();
    const parts = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < parts; i++) {
      const t = Math.random();
      let m;
      if (t < 0.3) {
        m = new THREE.Mesh(new THREE.BoxGeometry(rand(1.2, 2.2), 0.05, rand(0.6, 1.0)), DM.solar);
      } else if (t < 0.55) {
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, rand(0.8, 1.6), 14), Math.random() < 0.5 ? DM.gold : DM.metal);
      } else if (t < 0.8) {
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, rand(1.5, 2.5), 6), DM.dark);
      } else {
        m = new THREE.Mesh(new THREE.BoxGeometry(rand(0.4, 0.9), rand(0.4, 0.9), rand(0.4, 0.9)), DM.metal);
      }
      m.position.set(rand(-0.7, 0.7), rand(-0.5, 0.5), rand(-0.7, 0.7));
      m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      this.group.add(m);
    }
    // Мигающий маячок
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), DM.warn);
    this.beacon.position.set(rand(-0.5, 0.5), 0.5, 0);
    this.group.add(this.beacon);
    this.group.visible = false;
    this.active = false;
    this.spin = new THREE.Vector3();
    this.t = Math.random() * 10;
  }

  reset({ x, y, z, r }) {
    this.group.position.set(x, y, z);
    this.group.scale.setScalar(r);
    this.spin.set(rand(-2, 2), rand(-2, 2), rand(-2, 2));
    this.hitR = r * 1.1;
    this.extent = r * 2;
    this.active = true;
    this.group.visible = true;
  }

  update(dt, dz) {
    this.t += dt;
    const g = this.group;
    g.position.z += dz;
    g.rotation.x += this.spin.x * dt;
    g.rotation.y += this.spin.y * dt;
    g.rotation.z += this.spin.z * dt;
    this.beacon.visible = (this.t * 2.5) % 1 < 0.3;
  }

  hitTest(sp, z, shipR) {
    const p = this.group.position;
    const dx = sp.x - p.x, dy = sp.y - p.y, dzz = sp.z - z;
    const R = this.hitR + shipR;
    return dx * dx + dy * dy + dzz * dzz < R * R ? 'debris' : null;
  }

  deactivate() { this.active = false; this.group.visible = false; }
}
