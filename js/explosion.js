import * as THREE from 'three';
import { rand } from './util.js';

const VERT = /* glsl */ `
attribute float aLife; attribute float aSize; attribute vec3 aColor;
varying vec3 vColor; varying float vLife;
void main(){
  vLife = aLife;
  vColor = aColor;
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  gl_PointSize = aLife > 0.0 ? clamp(aSize*(110.0/-mv.z)*sqrt(aLife), 1.0, 22.0) : 0.0;
  gl_Position = projectionMatrix*mv;
}`;
const FRAG = /* glsl */ `
varying vec3 vColor; varying float vLife;
void main(){
  if (vLife <= 0.0) discard;
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vColor*a*vLife*1.6, 1.0);
}`;

export class Explosion {
  constructor(n = 700) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.color = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.cursor = 0;
  }

  burst(p, { count = 400, speed = 25, c1 = [1, 0.7, 0.3], c2 = [1, 0.2, 0.05], life = 1.6 } = {}) {
    for (let k = 0; k < count; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
      const u = rand(-1, 1), th = rand(0, Math.PI * 2), s = Math.sqrt(1 - u * u);
      const sp = speed * Math.pow(Math.random(), 0.5);
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel.set([Math.cos(th) * s * sp, Math.sin(th) * s * sp, u * sp], i * 3);
      this.maxLife[i] = life * rand(0.5, 1.2);
      this.life[i] = this.maxLife[i];
      this.size[i] = rand(0.3, 1.4);
      const m = Math.random();
      for (let c = 0; c < 3; c++) this.color[i * 3 + c] = c1[c] * (1 - m) + c2[c] * m;
    }
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }

  update(dt) {
    const L = this.geo.attributes.aLife.array;
    const drag = Math.exp(-1.6 * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { L[i] = 0; continue; }
      this.life[i] -= dt;
      for (let c = 0; c < 3; c++) {
        this.vel[i * 3 + c] *= drag;
        this.pos[i * 3 + c] += this.vel[i * 3 + c] * dt;
      }
      L[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
  }
}
