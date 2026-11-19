import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Q } from './quality.js';

// Финальный проход: гравитационная линза/закрутка вокруг точки, радиальное размытие скорости,
// хроматическая аберрация, красное смещение, виньетка, вспышки, затемнение при падении в дыру.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAspect: { value: 1 },
    uBlur: { value: 0 },
    uAberr: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uSwirl: { value: 0 },
    uLens: { value: 0 },
    uRedshift: { value: 0 },
    uDark: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uVig: { value: 0.35 },
    uVanish: { value: new THREE.Vector2(0.5, 0.55) },
    uShip: { value: new THREE.Vector2(0.5, 0.35) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAspect, uBlur, uAberr, uSwirl, uLens, uRedshift, uDark, uFlash, uVig;
    uniform vec2 uCenter, uVanish, uShip; uniform vec3 uFlashColor;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - uCenter; d.x *= uAspect;
      float r = length(d);
      if (uSwirl > 0.0 || uLens > 0.0){
        float ang = uSwirl/(r*5.0 + 0.12);
        float s = sin(ang), c = cos(ang);
        d = mat2(c, -s, s, c)*d;
        float rr = max(r, 1e-4);
        d = d/rr*(rr - uLens*0.006/rr);
        d.x /= uAspect;
        uv = uCenter + d;
      }
      vec2 dir = uv - uVanish;
      // Вокруг корабля размытие слабее, чтобы он оставался читаемым
      vec2 sd = uv - uShip; sd.x *= uAspect;
      float blur = uBlur*smoothstep(0.04, 0.16, length(sd));
      vec3 col = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < ${Q.blur}; i++){
        float t = float(i)/${(Q.blur - 1).toFixed(1)};
        float w = 1.0 - t*0.6;
        vec2 p = uVanish + dir*(1.0 - blur*t);
        vec2 ab = (p - uVanish)*uAberr;
        col.r += texture2D(tDiffuse, p + ab).r*w;
        col.g += texture2D(tDiffuse, p).g*w;
        col.b += texture2D(tDiffuse, p - ab).b*w;
        wsum += w;
      }
      col /= wsum;
      float lum = dot(col, vec3(0.3, 0.55, 0.15));
      col = mix(col, vec3(lum*1.4, lum*0.35, lum*0.12), uRedshift);
      vec2 vc = vUv - 0.5;
      col *= 1.0 - uVig*dot(vc, vc)*2.2;
      if (uDark > 0.0){
        float m = smoothstep(uDark*1.2 - 0.3, uDark*1.2, r);
        col *= mix(1.0, m, smoothstep(0.0, 0.2, uDark));
        col *= 1.0 - smoothstep(0.85, 1.0, uDark);
      }
      col += uFlashColor*uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class FX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    const size = renderer.getSize(new THREE.Vector2());
    this.bloom = new UnrealBloomPass(size, 0.7, 0.45, 0.85);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    this.u = this.final.uniforms;
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    // На телефонах bloom считаем в половинном разрешении — он размытый, разницы не видно
    if (Q.bloomScale < 1) this.bloom.setSize(Math.round(w * pr * Q.bloomScale), Math.round(h * pr * Q.bloomScale));
    this.u.uAspect.value = w / h;
  }

  render() { this.composer.render(); }
}

// Плавная тряска камеры: сумма синусоид с разными частотами
export function shakeOffset(t, amp, out) {
  out.set(
    (Math.sin(t * 41.3) + Math.sin(t * 23.7 + 1.3) * 0.7 + Math.sin(t * 67.1 + 2.1) * 0.4) * amp * 0.45,
    (Math.sin(t * 37.9 + 0.7) + Math.sin(t * 29.3 + 2.9) * 0.7 + Math.sin(t * 71.7) * 0.4) * amp * 0.45,
    0,
  );
  return out;
}
