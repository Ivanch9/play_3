import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, lerp } from './util.js';

const PLUME_VERT = /* glsl */ `
varying float vAlong; varying vec3 vN; varying vec3 vV;
void main(){
  vAlong = position.z;
  vN = normalize(normalMatrix*normal);
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix*mv;
}`;
const PLUME_FRAG = /* glsl */ `
uniform float uTime, uPower; uniform vec3 uColor;
varying float vAlong; varying vec3 vN; varying vec3 vV;
void main(){
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float flick = 0.78 + 0.22*sin(uTime*57.0 + vAlong*23.0)*sin(uTime*31.0);
  float a = pow(1.0 - vAlong, 1.7) * edge * flick;
  vec3 col = mix(uColor, vec3(1.6,1.8,2.0), pow(1.0 - vAlong, 5.0));
  gl_FragColor = vec4(col*a*uPower, 1.0);
}`;

export class Ship {
  constructor() {
    this.group = new THREE.Group();
    this.model = new THREE.Group();
    this.group.add(this.model);
    this.vel = new THREE.Vector3();
    this.time = 0;

    const hull = new THREE.MeshStandardMaterial({ color: 0xd3d9e4, metalness: 0.75, roughness: 0.26 });
    const hullDS = hull.clone(); hullDS.side = THREE.DoubleSide;
    const dark = new THREE.MeshStandardMaterial({ color: 0x232833, metalness: 0.6, roughness: 0.45 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x1f5f99, metalness: 0.9, roughness: 0.06, emissive: 0x0c3060, emissiveIntensity: 1.2,
    });
    const accent = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.75, 1.15) });
    this.accent = accent;

    // Фюзеляж — тело вращения, нос смотрит в −Z
    const prof = [[0, -2.0], [0.1, -1.75], [0.26, -1.2], [0.4, -0.45], [0.47, 0.35], [0.43, 0.95], [0.3, 1.12], [0, 1.12]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const fusGeo = new THREE.LatheGeometry(prof, 24);
    fusGeo.rotateX(Math.PI / 2);
    fusGeo.scale(1, 0.72, 1);
    this.model.add(new THREE.Mesh(fusGeo, hull));

    // Кабина
    const cab = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 14), glass);
    cab.scale.set(1, 0.75, 2.4);
    cab.position.set(0, 0.2, -0.55);
    this.model.add(cab);

    // Крылья
    const ws = new THREE.Shape();
    ws.moveTo(0.3, 0.55); ws.lineTo(2.05, -0.65); ws.lineTo(2.15, -1.0); ws.lineTo(0.3, -0.85); ws.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(ws, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
    wingGeo.rotateX(-Math.PI / 2);
    wingGeo.translate(0, -0.08, 0);
    const wingR = new THREE.Mesh(wingGeo, hullDS);
    const wingL = new THREE.Mesh(wingGeo.clone().scale(-1, 1, 1), hullDS);
    wingR.rotation.z = -0.06; wingL.rotation.z = 0.06;
    this.model.add(wingR, wingL);

    // Светящиеся полосы и законцовки крыльев
    for (const s of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.05), accent);
      stripe.position.set(s * 1.15, 0.0, 0.05);
      stripe.rotation.y = s * 0.6;
      this.model.add(stripe);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.45), accent);
      tip.position.set(s * 2.12, -0.12, 0.85);
      this.model.add(tip);
    }

    // Кили
    const fs = new THREE.Shape();
    fs.moveTo(0, 0); fs.lineTo(0.55, 0.0); fs.lineTo(0.85, 0.6); fs.lineTo(0.65, 0.6); fs.closePath();
    const finGeo = new THREE.ExtrudeGeometry(fs, { depth: 0.04, bevelEnabled: false });
    finGeo.rotateY(-Math.PI / 2);
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(finGeo, hullDS);
      fin.position.set(s * 0.3, 0.2, 0.35);
      fin.rotation.z = -s * 0.35;
      this.model.add(fin);
    }

    // Двигатели, сопла, факелы
    this.plumes = [];
    const plumeGeo = new THREE.ConeGeometry(0.19, 1, 20, 1, true);
    plumeGeo.translate(0, 0.5, 0);
    plumeGeo.rotateX(Math.PI / 2);
    this.plumeMat = new THREE.ShaderMaterial({
      vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG,
      uniforms: { uTime: { value: 0 }, uPower: { value: 1 }, uColor: { value: new THREE.Color(0.35, 0.75, 1.8) } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (const s of [-1, 1]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.9, 16), dark);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(s * 0.55, -0.06, 0.75);
      this.model.add(eng);
      const noz = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.65, 1.0) }));
      noz.position.set(s * 0.55, -0.06, 1.205);
      this.model.add(noz);
      const plume = new THREE.Mesh(plumeGeo, this.plumeMat);
      plume.position.set(s * 0.55, -0.06, 1.2);
      this.model.add(plume);
      this.plumes.push(plume);
    }

    const engLight = new THREE.PointLight(0x55bbff, 3, 8, 1.5);
    engLight.position.set(0, 0.3, 2.2);
    this.group.add(engLight);
    this.engLight = engLight;

    this.model.scale.setScalar(0.85);
  }

  reset() {
    this.group.position.set(0, 0, 0);
    this.group.quaternion.identity();
    this.model.scale.setScalar(0.85);
    this.model.rotation.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.group.visible = true;
  }

  // ax, ay — ввод [-1..1]; pull — внешнее ускорение (гравитация)
  update(dt, ax, ay, pull, frac, warp) {
    this.time += dt;
    const S = CFG.SHIP, B = CFG.BOUNDS;
    const p = this.group.position;
    this.vel.x += (ax * S.accel + pull.x) * dt;
    this.vel.y += (ay * S.accel + pull.y) * dt;
    const damp = Math.exp(-S.damping * dt);
    this.vel.x *= damp; this.vel.y *= damp;
    this.vel.x = clamp(this.vel.x, -S.maxV, S.maxV);
    this.vel.y = clamp(this.vel.y, -S.maxV, S.maxV);
    p.x += this.vel.x * dt;
    p.y += this.vel.y * dt;
    if (Math.abs(p.x) > B.x) { p.x = Math.sign(p.x) * B.x; this.vel.x *= -0.2; }
    if (Math.abs(p.y) > B.y) { p.y = Math.sign(p.y) * B.y; this.vel.y *= -0.2; }

    // Крен/тангаж для эффектности + лёгкое «покачивание»
    const r = this.model.rotation;
    r.z = lerp(r.z, -this.vel.x * 0.045 + Math.sin(this.time * 1.7) * 0.03, 1 - Math.exp(-8 * dt));
    r.x = lerp(r.x, this.vel.y * 0.03, 1 - Math.exp(-8 * dt));
    r.y = lerp(r.y, -this.vel.x * 0.012, 1 - Math.exp(-8 * dt));
    this.model.position.y = Math.sin(this.time * 2.3) * 0.05;

    this.animateEngines(dt, frac, warp);
  }

  animateEngines(dt, frac, warp) {
    this.plumeMat.uniforms.uTime.value = this.time;
    const len = 0.7 + frac * 3.2 + (warp - 1) * 1.2 + Math.sin(this.time * 40) * 0.08;
    for (const pl of this.plumes) pl.scale.set(1 + frac * 0.4, 1 + frac * 0.4, len);
    this.plumeMat.uniforms.uPower.value = 0.16 + frac * 0.32;
    const c = this.plumeMat.uniforms.uColor.value;
    // На световой факел становится фиолетово-белым
    c.setRGB(lerp(0.35, 1.2, frac * frac), lerp(0.75, 0.6, frac), lerp(1.8, 2.4, frac));
    this.engLight.intensity = 0.6 + frac * 1.0;
  }
}
