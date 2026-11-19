import * as THREE from 'three';
import { NOISE, HASH } from './glsl.js';

// Небесная сфера: процедурные туманности и звёзды.
// На околосветовой скорости — релятивистская аберрация (небо «сжимается» вперёд)
// и доплеровский сдвиг цвета (спереди синее и ярче, сзади краснее и темнее).
const VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
uniform float uBeta, uTime;
varying vec3 vDir;
${NOISE}
${HASH}
vec3 nebula(vec3 d){
  float n1 = fbm(d*1.8 + vec3(0.0, 0.0, uTime*0.004));
  float n2 = fbm3(d*4.2 + vec3(5.2));
  float band = exp(-pow(d.y*2.0 + d.x*0.6 + 0.35*n1, 2.0)*2.5);
  vec3 c1 = vec3(0.32,0.06,0.5), c2 = vec3(0.03,0.3,0.55), c3 = vec3(0.9,0.25,0.12);
  vec3 col = mix(c1, c2, smoothstep(-0.3,0.45,n2)) * smoothstep(-0.15,0.7,n1);
  col += c3*pow(max(n2,0.0),2.5)*1.4*smoothstep(0.0,0.6,n1);
  col *= 0.05 + band*0.45;
  return col;
}
void main(){
  vec3 d = normalize(vDir);
  float ct = -d.z;                 // косинус угла к направлению полёта (−Z)
  float b = uBeta;
  float cs = (ct - b)/(1.0 - b*ct); // направление на источник в системе покоя
  vec2 pn = length(d.xy) > 1e-5 ? normalize(d.xy) : vec2(1.0,0.0);
  vec3 src = vec3(pn*sqrt(max(0.0,1.0-cs*cs)), -cs);
  float gam = inversesqrt(1.0 - b*b);
  float D = 1.0/(gam*(1.0 - b*ct)); // доплер-фактор
  vec3 col = nebula(src);
  col += starLayer(src, 150.0, 0.94)*1.2 + starLayer(src, 60.0, 0.985)*2.0;
  // Сдвиг цвета: D>1 — в синий, D<1 — в красный
  vec3 w = vec3(pow(D,-1.4), pow(D,0.15), pow(D,1.4));
  col *= w * clamp(D*D, 0.0, 2.5);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor() {
    this.uniforms = { uBeta: { value: 0 }, uTime: { value: 0 } };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(4000, 64, 32),
      new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
        side: THREE.BackSide, depthWrite: false,
      }),
    );
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  update(camera, beta, time) {
    this.mesh.position.copy(camera.position);
    this.uniforms.uBeta.value = beta;
    this.uniforms.uTime.value = time;
  }
}
