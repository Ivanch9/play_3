import * as THREE from 'three';
import { NOISE, BLACKBODY } from '../glsl.js';
import { CFG } from '../config.js';
import { rand, smoothstep } from '../util.js';

// Квазар: сверхъяркое ядро, горячий аккреционный диск, два релятивистских джета и ореол галактики.
// Смертельны ядро и джеты.
const BB_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

const CORE_FRAG = /* glsl */ `
uniform float uTime, uFade;
varying vec2 vUv;
void main(){
  vec2 d = (vUv - 0.5)*2.0;
  float r = length(d);
  float flick = 0.85 + 0.15*sin(uTime*13.0)*sin(uTime*7.3 + 1.0);
  float core = exp(-r*22.0)*10.0 + exp(-r*7.0)*1.4 + exp(-r*2.2)*0.3;
  float sp = exp(-abs(d.x)*120.0)*exp(-abs(d.y)*2.5) + exp(-abs(d.y)*120.0)*exp(-abs(d.x)*2.5);
  vec3 col = vec3(0.8,0.88,1.0)*core*flick + vec3(0.55,0.65,1.0)*sp*2.0*flick;
  col *= 1.0 - smoothstep(0.8, 1.0, r);
  gl_FragColor = vec4(col*uFade, 1.0);
}`;

const HALO_FRAG = /* glsl */ `
uniform float uTime, uFade;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 d = (vUv - 0.5)*2.0;
  vec2 e = vec2(d.x, d.y*1.8);
  float r = length(e);
  float a = atan(e.y, e.x);
  float arms = 0.5 + 0.5*sin(a*2.0 - log(r + 0.05)*5.0 + uTime*0.05);
  float n = fbm3(vec3(d*4.0, uTime*0.02));
  float g = exp(-r*3.5)*(0.6 + 0.4*arms)*(0.7 + 0.5*n) + exp(-r*12.0)*0.8;
  vec3 col = mix(vec3(1.0,0.75,0.5), vec3(0.6,0.7,1.0), arms*smoothstep(0.1,0.6,r))*g*0.35;
  col *= 1.0 - smoothstep(0.7, 1.0, length(d));
  gl_FragColor = vec4(col*uFade, 1.0);
}`;

const DISK_VERT = /* glsl */ `
varying vec3 vP; varying vec3 vWorld;
void main(){
  vP = position;
  vec4 w = modelMatrix*vec4(position,1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix*viewMatrix*w;
}`;
const DISK_FRAG = /* glsl */ `
uniform float uTime, uFade, uRin, uRout; uniform vec3 uAxis, uCenter;
varying vec3 vP; varying vec3 vWorld;
${NOISE}
${BLACKBODY}
void main(){
  float r = length(vP.xy);
  float x = (r - uRin)/(uRout - uRin);
  float ang = atan(vP.y, vP.x) - uTime*3.0/pow(r/uRin, 1.5);
  vec2 q = vec2(cos(ang), sin(ang));
  float n = fbm3(vec3(q*2.0, r/uRin*1.5));
  float dens = smoothstep(0.0, 0.08, x)*(1.0 - smoothstep(0.3, 1.0, x))*clamp(0.6 + 0.8*n, 0.0, 1.5);
  // Доплер по направлению вращения
  vec3 radial = normalize(vWorld - uCenter);
  vec3 vdir = normalize(cross(uAxis, radial));
  vec3 toCam = normalize(cameraPosition - vWorld);
  float beta = 0.45*pow(uRin/r, 0.5);
  float D = 1.0/(inversesqrt(1.0-beta*beta)*(1.0 - beta*dot(vdir, toCam)));
  float T = 30000.0*pow(uRin/r, 0.75)*D;
  vec3 col = blackbody(T)*pow(D, 3.0)*dens*2.5;
  gl_FragColor = vec4(col*uFade, 1.0);
}`;

const JET_VERT = /* glsl */ `
varying float vAlong; varying vec3 vN; varying vec3 vV;
void main(){
  vAlong = position.y;
  vN = normalize(normalMatrix*normal);
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix*mv;
}`;
const JET_FRAG = /* glsl */ `
uniform float uTime, uFade, uI, uLen;
varying float vAlong; varying vec3 vN; varying vec3 vV;
${NOISE}
void main(){
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
  float s = vAlong*uLen;
  float knots = 0.55 + 0.45*pow(0.5 + 0.5*sin(s*0.06 - uTime*14.0), 6.0);
  float turb = 0.75 + 0.35*snoise(vec3(s*0.02 - uTime*3.0, edge*2.0, 0.0));
  float fall = pow(1.0 - vAlong, 0.7);
  vec3 col = mix(vec3(1.4,1.8,3.2), vec3(1.2,0.5,2.4), smoothstep(0.0, 0.6, vAlong));
  gl_FragColor = vec4(col*edge*knots*turb*fall*uI*uFade, 1.0);
}`;

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

function additive(vert, frag, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, uniforms,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...extra,
  });
}

export class Quasar {
  constructor() {
    this.kind = 'quasar';
    this.giant = true;
    this.u = { uTime: { value: 0 }, uFade: { value: 1 } };
    this.group = new THREE.Group();

    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(BB_VERT, HALO_FRAG, this.u));
    this.core = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(BB_VERT, CORE_FRAG, this.u));
    this.diskU = { ...this.u, uRin: { value: 3 }, uRout: { value: 18 }, uAxis: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector3() } };
    this.disk = new THREE.Mesh(new THREE.RingGeometry(3, 18, 160, 6), additive(DISK_VERT, DISK_FRAG, this.diskU, { side: THREE.DoubleSide }));

    this.jetU = { ...this.u, uI: { value: 1.6 }, uLen: { value: 600 } };
    this.glowU = { ...this.u, uI: { value: 0.35 }, uLen: { value: 600 } };
    this.jets = [];
    for (const s of [1, -1]) {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
      geo.translate(0, 0.5, 0);
      const jet = new THREE.Mesh(geo, additive(JET_VERT, JET_FRAG, this.jetU, { side: THREE.DoubleSide }));
      const glow = new THREE.Mesh(geo, additive(JET_VERT, JET_FRAG, this.glowU, { side: THREE.DoubleSide }));
      jet.frustumCulled = glow.frustumCulled = false;
      this.jets.push({ jet, glow, s });
      this.group.add(jet, glow);
    }
    this.group.add(this.halo, this.disk, this.core);
    for (const m of [this.halo, this.core, this.disk]) m.frustumCulled = false;
    this.group.visible = false;
    this.active = false;
    this.axis = new THREE.Vector3();
    this.lightColor = new THREE.Color(0.7, 0.8, 1.0);
  }

  reset({ x, y, z, axis, jetR = 1.3, L = 650 }) {
    this.group.position.set(x, y, z);
    this.axis.copy(axis).normalize();
    this.jetR = jetR;
    this.L = L;
    this.killR = 3.5;
    this.extent = 120;
    this.halo.scale.setScalar(260);
    this.core.scale.setScalar(70);
    this.disk.quaternion.setFromUnitVectors(Z, this.axis);
    this.diskU.uRin.value = 3;
    this.diskU.uRout.value = 18;
    this.diskU.uAxis.value.copy(this.axis);
    this.jetU.uLen.value = L;
    this.glowU.uLen.value = L;
    // Джет расширяется от ядра наружу: r0 у основания, r1 на конце
    this.r0 = jetR * 0.7;
    this.r1 = jetR * 3.5;
    for (const { jet, glow, s } of this.jets) {
      _a.copy(this.axis).multiplyScalar(s);
      jet.quaternion.setFromUnitVectors(Y, _a);
      glow.quaternion.copy(jet.quaternion);
      jet.scale.set(1, L, 1);
      glow.scale.set(1, L, 1);
      // Радиус задаём через геометрию: масштаб X/Z меняет весь конус, поэтому используем среднее
      jet.scale.x = jet.scale.z = (this.r0 + this.r1) * 0.5;
      glow.scale.x = glow.scale.z = (this.r0 + this.r1) * 1.6;
    }
    this.age = rand(0, 10);
    this.passed = false;
    this.active = true;
    this.group.visible = true;
  }

  update(dt, dz, camera) {
    this.age += dt;
    const p = this.group.position;
    p.z += dz;
    this.u.uTime.value = this.age;
    this.u.uFade.value = smoothstep(CFG.GIANT_Z - this.extent, CFG.GIANT_Z + 500, p.z);
    this.diskU.uCenter.value.copy(p);
    this.core.quaternion.copy(camera.quaternion);
    this.halo.quaternion.copy(camera.quaternion);
  }

  // Расстояние от точки до оси джетов (с учётом длины) и радиус джета в этой точке
  jetDist(sp, z) {
    const p = this.group.position;
    _b.set(sp.x - p.x, sp.y - p.y, sp.z - z);
    const t = _b.dot(this.axis);               // проекция на ось (знак — какой из джетов)
    const at = Math.min(Math.abs(t), this.L);
    _a.copy(this.axis).multiplyScalar(Math.sign(t) * at);
    const d = _b.distanceTo(_a);
    const jr = (this.r0 + this.r1) * 0.5 * 0.9;
    return { d, jr };
  }

  gap(sp) {
    const p = this.group.position;
    const { d, jr } = this.jetDist(sp, p.z);
    const core = Math.hypot(sp.x - p.x, sp.y - p.y) - this.killR;
    return Math.min(core, d - jr);
  }

  hitTest(sp, z, shipR) {
    const p = this.group.position;
    const dx = sp.x - p.x, dy = sp.y - p.y, dzz = sp.z - z;
    if (dx * dx + dy * dy + dzz * dzz < (this.killR + shipR) ** 2) return 'quasar';
    const { d, jr } = this.jetDist(sp, z);
    return d < jr + shipR * 0.6 ? 'jet' : null;
  }

  pull(sp, out) {
    const p = this.group.position;
    const dzAhead = sp.z - p.z;
    if (dzAhead < 0 || dzAhead > CFG.GRAVITY.range) return 0;
    const dx = p.x - sp.x, dy = p.y - sp.y;
    const d = Math.max(Math.hypot(dx, dy), 2);
    const a = CFG.GRAVITY.G * 0.6 * (1 - smoothstep(0, CFG.GRAVITY.range, dzAhead)) * Math.min(1.5, (8 / d) ** 2);
    out.x += (dx / d) * a;
    out.y += (dy / d) * a;
    return a;
  }

  deactivate() { this.active = false; this.group.visible = false; }
}
