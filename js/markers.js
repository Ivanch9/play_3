import * as THREE from 'three';
import { CFG } from './config.js';
import { smoothstep } from './util.js';

// Маркеры опасности: проекция смертельной зоны гиганта на плоскость корабля.
// Позволяют заранее понять, куда уходить, пока объект ещё далеко в центре «тоннеля».
const RING_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity, uTime;
varying vec2 vUv;
void main(){
  vec2 d = (vUv - 0.5)*2.0;
  float r = length(d);
  float a = atan(d.y, d.x);
  float dash = step(0.0, sin(a*24.0 + uTime*3.0));
  float ring = smoothstep(0.035, 0.0, abs(r - 0.97))*(0.55 + 0.45*dash);
  float fill = smoothstep(1.0, 0.0, r)*0.12*step(r, 1.0);
  float pulse = 0.75 + 0.25*sin(uTime*8.0);
  gl_FragColor = vec4(uColor*(ring + fill)*uOpacity*pulse, 1.0);
}`;
const STRIP_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity, uTime;
varying vec2 vUv;
void main(){
  float y = abs(vUv.y - 0.5)*2.0;
  float edge = smoothstep(0.12, 0.0, abs(y - 0.92));
  float dash = step(0.0, sin(vUv.x*160.0 - uTime*12.0));
  float fill = 0.12*step(y, 1.0);
  float fadeEnds = smoothstep(0.0, 0.1, vUv.x)*smoothstep(1.0, 0.9, vUv.x);
  float pulse = 0.75 + 0.25*sin(uTime*8.0);
  gl_FragColor = vec4(uColor*(edge*(0.5 + 0.5*dash) + fill)*uOpacity*pulse*fadeEnds, 1.0);
}`;
const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

const COLORS = {
  blackhole: new THREE.Color(1.2, 0.25, 0.9),
  star: new THREE.Color(1.4, 0.6, 0.15),
  quasar: new THREE.Color(1.3, 0.2, 0.2),
  jet: new THREE.Color(0.5, 0.6, 1.6),
};

function mat(frag) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: frag,
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uTime: { value: 0 } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  });
}

export class Markers {
  constructor(scene) {
    this.rings = Array.from({ length: 8 }, () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat(RING_FRAG));
      m.renderOrder = 50; m.visible = false; m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    this.strips = Array.from({ length: 4 }, () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(STRIP_FRAG));
      m.renderOrder = 50; m.visible = false; m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    this.time = 0;
  }

  update(dt, giants, shipZ, enabled) {
    this.time += dt;
    let ri = 0, si = 0;
    for (const g of giants) {
      if (!enabled || !g.active) continue;
      const p = g.group.position;
      if (p.z > shipZ + 5) continue;
      const op = smoothstep(CFG.GIANT_Z, CFG.GIANT_Z + 500, p.z) * (1 - smoothstep(shipZ - 60, shipZ, p.z)) * 0.6;
      if (op <= 0.001) continue;
      const killR = g.killR;
      if (ri < this.rings.length) {
        const r = this.rings[ri++];
        r.visible = true;
        r.position.set(p.x, p.y, shipZ - 0.5);
        r.scale.setScalar(killR);
        const u = r.material.uniforms;
        u.uColor.value.copy(COLORS[g.kind]);
        u.uOpacity.value = op;
        u.uTime.value = this.time;
      }
      if (g.kind === 'quasar' && si < this.strips.length) {
        const s = this.strips[si++];
        s.visible = true;
        const ang = Math.atan2(g.axis.y, g.axis.x);
        const L = 200;
        // Полоса центрирована на ядре и идёт вдоль проекции оси джетов
        s.position.set(p.x, p.y, shipZ - 0.5);
        s.rotation.set(0, 0, ang);
        const jr = (g.r0 + g.r1) * 0.5 * 0.9;
        s.scale.set(L * 2, jr * 2.2, 1);
        const u = s.material.uniforms;
        u.uColor.value.copy(COLORS.jet);
        u.uOpacity.value = op;
        u.uTime.value = this.time;
      }
    }
    for (; ri < this.rings.length; ri++) this.rings[ri].visible = false;
    for (; si < this.strips.length; si++) this.strips[si].visible = false;
  }
}
