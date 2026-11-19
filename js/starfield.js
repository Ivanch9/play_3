import * as THREE from 'three';

// Звёздное поле: каждая звезда — отрезок (голова + хвост). Длина хвоста растёт со скоростью,
// на «световой» звёзды превращаются в разноцветные полосы. Плюс слой точек для малых скоростей.
const VERT = /* glsl */ `
attribute float aSeed;
attribute float aEnd;
uniform float uTravel, uDepth, uNear, uStretch, uWarp, uTime, uBright, uPointSize, uRMin, uViewH;
varying vec3 vColor;
void main(){
  float z = mod(position.z + uTravel, uDepth) - uDepth + uNear;
  float len = uStretch*(0.35+0.65*fract(aSeed*13.17));
  vec3 p = vec3(position.xy, z - aEnd*len);
  vec4 mv = modelViewMatrix*vec4(p,1.0);
  gl_Position = projectionMatrix*mv;
  // Дальние звёзды плавно проявляются по мере приближения (без резкого «зажигания»)
  float fadeFar = smoothstep(0.0, 0.55, (z - (uNear - uDepth))/uDepth);
  float ang = atan(position.y, position.x);
  vec3 hue = 0.5 + 0.5*cos(6.28318*(ang/3.14159 + aSeed*0.25 + uTime*0.12 + vec3(0.0,0.33,0.67)));
  vec3 base = mix(vec3(0.75,0.85,1.0), vec3(1.0,0.78,0.55), step(0.72, fract(aSeed*7.31)));
  vec3 col = mix(base, hue*1.7 + 0.15, uWarp);
  float tw = 0.45 + 0.55*fract(aSeed*3.71);
  // На варпе центр «тоннеля» темнее — полосы уходят на стенки
  float rad = length(position.xy);
  float tunnel = mix(1.0, 0.7*smoothstep(uRMin, uRMin*6.0, rad), uWarp);
  vColor = col*uBright*tw*fadeFar*tunnel*(1.0 - aEnd*0.98)/(1.0 + uStretch*0.006);
  #ifdef POINTS
  // Субпиксельные точки не раздуваем до 1 px на полной яркости — гасим пропорционально размеру
  float sz = uPointSize*(260.0/-mv.z)*(uViewH/900.0);
  gl_PointSize = clamp(sz, 1.0, 6.0);
  vColor *= clamp(sz*sz, 0.0, 1.0);
  #else
  // Полосы короче ~2 px мерцают при движении — плавно гасим их
  vec4 hc = projectionMatrix*modelViewMatrix*vec4(position.xy, z, 1.0);
  vec4 tc = projectionMatrix*modelViewMatrix*vec4(position.xy, z - len, 1.0);
  float px = length(hc.xy/hc.w - tc.xy/tc.w)*0.5*uViewH;
  vColor *= smoothstep(1.5, 6.0, px);
  #endif
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main(){
  #ifdef POINTS
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(c));
  gl_FragColor = vec4(vColor*a, 1.0);
  #else
  gl_FragColor = vec4(vColor, 1.0);
  #endif
}`;

export class Starfield {
  constructor({ count, rMin, rMax, depth, near = 12, bright = 1, pointSize = 1.4 }) {
    this.depth = depth;
    this.travel = 0;
    this.group = new THREE.Group();

    const base = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rMin + (rMax - rMin) * Math.pow(Math.random(), 0.7);
      base[i * 3] = Math.cos(a) * r;
      base[i * 3 + 1] = Math.sin(a) * r;
      base[i * 3 + 2] = Math.random() * depth;
      seeds[i] = Math.random() * 100;
    }

    this.uniforms = {
      uTravel: { value: 0 }, uDepth: { value: depth }, uNear: { value: near },
      uStretch: { value: 0 }, uWarp: { value: 0 }, uTime: { value: 0 },
      uBright: { value: bright }, uPointSize: { value: pointSize }, uRMin: { value: rMin }, uViewH: { value: 900 },
    };

    // Линии: 2 вершины на звезду
    const lpos = new Float32Array(count * 6), lseed = new Float32Array(count * 2), lend = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        lpos.set(base.subarray(i * 3, i * 3 + 3), j * 3);
        lseed[j] = seeds[i];
        lend[j] = k;
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
    lg.setAttribute('aSeed', new THREE.BufferAttribute(lseed, 1));
    lg.setAttribute('aEnd', new THREE.BufferAttribute(lend, 1));
    this.lineMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.lines = new THREE.LineSegments(lg, this.lineMat);
    this.lines.frustumCulled = false;

    // Точки
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(base, 3));
    pg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    pg.setAttribute('aEnd', new THREE.BufferAttribute(new Float32Array(count), 1));
    this.pointUniforms = { ...this.uniforms, uBright: { value: bright } };
    this.pointMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.pointUniforms, defines: { POINTS: '' },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.points = new THREE.Points(pg, this.pointMat);
    this.points.frustumCulled = false;
    this.baseBright = bright;

    this.group.add(this.lines, this.points);
  }

  setViewHeight(h) { this.uniforms.uViewH.value = h; }

  update(dTravel, stretch, warp, time, pointsVis) {
    this.travel = (this.travel + dTravel) % this.depth;
    const u = this.uniforms;
    u.uTravel.value = this.travel;
    u.uStretch.value = stretch;
    u.uWarp.value = warp;
    u.uTime.value = time;
    this.pointUniforms.uBright.value = this.baseBright * pointsVis;
    this.points.visible = pointsVis > 0.01;
  }
}
