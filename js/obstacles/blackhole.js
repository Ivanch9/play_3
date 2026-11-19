import * as THREE from 'three';
import { NOISE, HASH, BLACKBODY } from '../glsl.js';
import { CFG } from '../config.js';
import { rand, smoothstep } from '../util.js';

// Чёрная дыра Шварцшильда. Для каждого пикселя билборда трассируем луч света назад во времени
// с изгибом траектории a = -3/2 · h² · r / |r|^5 (единицы r_s = 1), что даёт:
//  • тень радиусом ~2.6 r_s и фотонное кольцо;
//  • изогнутый линзированием аккреционный диск (его дальняя часть видна над и под тенью);
//  • доплеровское усиление приближающейся стороны диска и гравитационное красное смещение;
//  • линзирование фоновых звёзд.
const BOUND = 13.0;

const VERT = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix*vec4(position,1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix*viewMatrix*w;
}`;

const FRAG = /* glsl */ `
uniform vec3 uCenter; uniform float uRs; uniform mat3 uRot; uniform float uTime; uniform float uFade; uniform float uBound;
uniform float uHot;
varying vec3 vWorld;
${NOISE}
${HASH}
${BLACKBODY}
const float RIN = 3.0;
const float ROUT = 11.0;

vec4 disk(vec3 p, vec3 dir){
  float r = length(p.xz);
  float x = clamp((r - RIN)/(ROUT - RIN), 0.0, 1.0);
  // Профиль температуры тонкого диска (Шакура–Сюняев)
  float tprof = pow(RIN/r, 0.75)*pow(max(1.0 - sqrt(RIN*0.85/r), 0.0), 0.25)*1.9;
  // Кеплеровская скорость и доплер
  float beta = clamp(sqrt(0.5/max(r - 1.0, 0.5)), 0.0, 0.75);
  vec3 vdir = normalize(vec3(-p.z, 0.0, p.x));
  float cosA = dot(vdir, -dir);
  float gam = inversesqrt(1.0 - beta*beta);
  float D = 1.0/(gam*(1.0 - beta*cosA));
  float g = D*sqrt(max(1.0 - 1.0/r, 0.05));
  // Турбулентность, вращающаяся дифференциально
  float ang = atan(p.z, p.x) - uTime*2.4/pow(r, 1.5);
  vec2 q = vec2(cos(ang), sin(ang));
  float n = fbm(vec3(q*1.7, r*1.1));
  float n2 = snoise(vec3(q*4.0, r*5.5 + uTime*0.2));
  float dens = smoothstep(0.0, 0.05, x)*(1.0 - smoothstep(0.35, 1.0, x));
  dens *= clamp(0.55 + 0.75*n + 0.3*n2, 0.0, 1.6);
  float T = uHot*tprof*g;
  vec3 c = blackbody(T)*pow(g, 3.0)*(1.6*tprof*tprof + 0.12)*0.75;
  float a = clamp(dens*1.25, 0.0, 1.0);
  return vec4(c*a, a);
}

void main(){
  vec3 rdW = normalize(vWorld - cameraPosition);
  vec3 ro = uRot*((cameraPosition - uCenter)/uRs);
  vec3 rd = normalize(uRot*rdW);
  float b = dot(ro, rd);
  float c = dot(ro, ro) - uBound*uBound;
  float disc = b*b - c;
  if (disc < 0.0) discard;
  float sq = sqrt(disc);
  if (-b + sq < 0.0) discard;
  vec3 pos = ro + rd*max(-b - sq, 0.0);
  vec3 vel = rd;
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  bool captured = false, escaped = false;
  float minR = 1e5;
  for (int i = 0; i < 150; i++){
    float r = length(pos);
    minR = min(minR, r);
    if (r < 1.0){ captured = true; break; }
    if (r > uBound + 0.01 && dot(pos, vel) > 0.0){ escaped = true; break; }
    float dt = clamp(0.085*r, 0.012, 0.9);
    vec3 acc = -1.5*h2*pos/pow(r, 5.0);
    vel += acc*dt;
    vec3 np = pos + vel*dt;
    if (pos.y*np.y < 0.0){
      vec3 hp = mix(pos, np, pos.y/(pos.y - np.y));
      float rr = length(hp.xz);
      if (rr > RIN*0.92 && rr < ROUT){
        vec4 dc = disk(hp, normalize(vel));
        col += (1.0 - alpha)*dc.rgb;
        alpha += (1.0 - alpha)*dc.a;
      }
    }
    pos = np;
    if (alpha > 0.995) break;
  }
  float bImp = sqrt(h2);
  if (escaped){
    vec3 dir = normalize(vel);
    float bgA = 1.0 - smoothstep(4.0, 10.5, bImp);
    vec3 bg = starLayer(dir, 70.0, 0.985)*1.4 + vec3(0.004, 0.003, 0.008);
    float ring = exp(-pow((minR - 1.56)*6.0, 2.0));
    col += (1.0 - alpha)*(bg*bgA + vec3(1.0, 0.72, 0.42)*ring*0.9);
    alpha += (1.0 - alpha)*max(bgA, ring);
  } else {
    alpha = 1.0; // тень (горизонт событий) — абсолютно чёрная
  }
  gl_FragColor = vec4(col*uFade, alpha*uFade);
}`;

const UP = new THREE.Vector3(0, 0, 1);

export class BlackHole {
  constructor() {
    this.kind = 'blackhole';
    this.giant = true;
    this.uniforms = {
      uCenter: { value: new THREE.Vector3() },
      uRs: { value: 4 },
      uRot: { value: new THREE.Matrix3() },
      uTime: { value: 0 },
      uFade: { value: 1 },
      uBound: { value: BOUND },
      uHot: { value: 9000 },
    };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, premultipliedAlpha: true,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.group.visible = false;
    this.active = false;
    this.lightColor = new THREE.Color(1.0, 0.6, 0.3);
  }

  reset({ x, y, z, rs }) {
    this.rs = rs;
    this.killR = 2.6 * rs * 0.9;          // видимый край тени
    this.extent = BOUND * rs;
    this.group.position.set(x, y, z);
    this.mesh.scale.setScalar(2 * BOUND * rs * 1.3);
    this.uniforms.uRs.value = rs;
    this.uniforms.uHot.value = rand(4800, 6800);

    // Ориентация диска: наблюдатель почти в плоскости диска (как на знаменитых визуализациях)
    const incl = rand(0.08, 0.32) * (Math.random() < 0.5 ? 1 : -1);
    const roll = rand(-0.5, 0.5);
    const n = new THREE.Vector3(0, Math.cos(incl), Math.sin(incl)).applyAxisAngle(UP, roll).normalize();
    const lx = new THREE.Vector3().crossVectors(n, UP).normalize();
    const lz = new THREE.Vector3().crossVectors(lx, n).normalize();
    this.uniforms.uRot.value.set(lx.x, lx.y, lx.z, n.x, n.y, n.z, lz.x, lz.y, lz.z);
    this.age = rand(0, 5);
    this.passed = false;
    this.minGap = Infinity;
    this.active = true;
    this.group.visible = true;
  }

  update(dt, dz, camera) {
    this.age += dt;
    const p = this.group.position;
    p.z += dz;
    this.uniforms.uCenter.value.copy(p);
    this.uniforms.uTime.value = this.age;
    this.uniforms.uFade.value = smoothstep(CFG.GIANT_Z - this.extent, CFG.GIANT_Z + 500, p.z);
    this.mesh.quaternion.copy(camera.quaternion);
  }

  gap(sp) {
    const p = this.group.position;
    return Math.hypot(sp.x - p.x, sp.y - p.y) - this.killR;
  }

  hitTest(sp, z, shipR) {
    const p = this.group.position;
    const dx = sp.x - p.x, dy = sp.y - p.y, dzz = sp.z - z;
    const R = this.killR + shipR * 0.5;
    return dx * dx + dy * dy + dzz * dzz < R * R ? 'blackhole' : null;
  }

  // Притяжение: геймплейное (не физическое) — тянет к оси дыры, пока она приближается.
  pull(sp, out) {
    const p = this.group.position;
    const dzAhead = sp.z - p.z; // >0 пока дыра впереди
    if (dzAhead < -this.extent * 0.3 || dzAhead > CFG.GRAVITY.range) return 0;
    const fz = 1 - smoothstep(0, CFG.GRAVITY.range, dzAhead);
    const dx = p.x - sp.x, dy = p.y - sp.y;
    const d = Math.max(Math.hypot(dx, dy), this.killR * 0.5);
    const a = CFG.GRAVITY.G * fz * Math.min(2.2, Math.pow(this.killR / d, 2) * 1.4);
    out.x += (dx / d) * a;
    out.y += (dy / d) * a;
    return a;
  }

  deactivate() { this.active = false; this.group.visible = false; }
}
