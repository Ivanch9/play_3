import * as THREE from 'three';
import { NOISE, BLACKBODY } from '../glsl.js';
import { CFG } from '../config.js';
import { rand, pick, smoothstep } from '../util.js';
import { Q } from '../quality.js';

// Звезда: фотосфера с грануляцией, пятнами и потемнением к краю; корона с выбросами.
const SURF_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec3 vV;
void main(){
  vP = position;
  vN = normalize(normalMatrix*normal);
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix*mv;
}`;
const SURF_FRAG = /* glsl */ `
uniform float uTime, uTemp, uI, uFade, uSeed;
varying vec3 vN; varying vec3 vP; varying vec3 vV;
${NOISE}
${BLACKBODY}
void main(){
  vec3 p = normalize(vP);
  float mu = max(dot(normalize(vN), normalize(vV)), 0.0);
  float gran = snoise(p*28.0 + vec3(uTime*0.25, uSeed, 0.0))*0.6 + snoise(p*60.0 - uTime*0.3)*0.4;
  float big = fbm(p*3.5 + vec3(uSeed, uTime*0.03, 0.0));
  float sn = snoise(p*2.2 + vec3(uSeed*2.0)) + 0.25*big;
  float spots = smoothstep(0.62, 0.78, sn);
  float penumbra = smoothstep(0.5, 0.64, sn);
  float T = uTemp*(0.78 + 0.22*mu)*(1.0 + 0.06*gran + 0.05*big)*(1.0 - 0.3*spots - 0.1*penumbra);
  float limb = 1.0 - 0.62*(1.0 - pow(mu, 0.6));
  float fac = smoothstep(0.2, 0.6, big)*(1.0 - mu)*0.5; // факелы у края
  vec3 col = blackbody(T)*uI*(limb*(1.0 - 0.75*spots - 0.25*penumbra) + fac);
  gl_FragColor = vec4(col*uFade, 1.0);
}`;

const COR_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const COR_FRAG = /* glsl */ `
uniform float uTime, uTemp, uI, uFade, uRatio, uSeed;
varying vec2 vUv;
${NOISE}
${BLACKBODY}
void main(){
  vec2 d = (vUv - 0.5)*2.0;
  float r = length(d)/uRatio;          // 1.0 = край фотосферы
  float x = max(r - 1.0, 0.0);
  float a = atan(d.y, d.x);
  vec2 q = vec2(cos(a), sin(a));
  float streams = fbm3(vec3(q*3.0, x*1.5 - uTime*0.15 + uSeed));
  float rays = pow(abs(snoise(vec3(q*9.0, uTime*0.05 + uSeed))), 0.5);
  float glow = exp(-x*5.0)*(0.7 + 0.6*streams) + exp(-x*1.4)*0.22*(0.6 + 0.6*rays);
  // Протуберанцы — яркие петли у самого лимба
  float prom = smoothstep(0.35, 0.75, fbm3(vec3(q*7.0, uTime*0.08 + uSeed)))*exp(-x*14.0)*step(0.0, r - 1.0);
  vec3 col = blackbody(uTemp*1.05)*glow*uI*0.9 + vec3(2.2, 0.35, 0.12)*prom*uI*0.6;
  col *= 1.0 - smoothstep(0.75, 1.0, length(d));
  gl_FragColor = vec4(col*uFade, 1.0);
}`;

const CLASSES = [3300, 4300, 5800, 7500, 11000, 22000];

export class Star {
  constructor() {
    this.kind = 'star';
    this.giant = true;
    this.uniforms = {
      uTime: { value: 0 }, uTemp: { value: 5800 }, uI: { value: 3 }, uFade: { value: 1 }, uSeed: { value: 0 },
    };
    this.surf = new THREE.Mesh(
      new THREE.SphereGeometry(1, Q.starSeg[0], Q.starSeg[1]),
      new THREE.ShaderMaterial({ vertexShader: SURF_VERT, fragmentShader: SURF_FRAG, uniforms: this.uniforms }),
    );
    this.corUniforms = { ...this.uniforms, uRatio: { value: 0.4 } };
    this.corona = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: COR_VERT, fragmentShader: COR_FRAG, uniforms: this.corUniforms,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.corona.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.surf, this.corona);
    this.group.visible = false;
    this.active = false;
    this.lightColor = new THREE.Color();
  }

  reset({ x, y, z, R }) {
    this.R = R;
    this.killR = R * 1.06;
    this.extent = R * 3;
    this.group.position.set(x, y, z);
    this.surf.scale.setScalar(R);
    const C = 2.5;
    this.corona.scale.setScalar(R * 2 * C);
    this.corUniforms.uRatio.value = 1 / C;
    const T = pick(CLASSES) * rand(0.92, 1.08);
    this.uniforms.uTemp.value = T;
    this.uniforms.uI.value = T > 9000 ? 2.0 : 1.6;
    this.uniforms.uSeed.value = rand(0, 100);
    this.surf.rotation.set(rand(0, 6), rand(0, 6), 0);
    // Цвет света для освещения корабля
    const t = T / 100;
    this.lightColor.setRGB(1, Math.min(1, 0.39 * Math.log(t) - 0.63), t >= 66 ? 1 : Math.max(0, 0.54 * Math.log(t - 10) - 1.2));
    this.age = 0;
    this.passed = false;
    this.active = true;
    this.group.visible = true;
  }

  update(dt, dz, camera) {
    this.age += dt;
    const p = this.group.position;
    p.z += dz;
    this.uniforms.uTime.value = this.age;
    this.uniforms.uFade.value = smoothstep(CFG.GIANT_Z - this.extent, CFG.GIANT_Z + 500, p.z);
    this.surf.rotation.y += dt * 0.05;
    this.corona.quaternion.copy(camera.quaternion);
  }

  gap(sp) {
    const p = this.group.position;
    return Math.hypot(sp.x - p.x, sp.y - p.y) - this.killR;
  }

  hitTest(sp, z, shipR) {
    const p = this.group.position;
    const dx = sp.x - p.x, dy = sp.y - p.y, dzz = sp.z - z;
    const R = this.killR + shipR * 0.6;
    return dx * dx + dy * dy + dzz * dzz < R * R ? 'star' : null;
  }

  pull() { return 0; }

  deactivate() { this.active = false; this.group.visible = false; }
}
