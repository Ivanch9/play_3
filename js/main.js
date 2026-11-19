import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CFG, speedAt } from './config.js';
import { clamp, lerp, smoothstep } from './util.js';
import { input } from './input.js';
import { Ship } from './ship.js';
import { Starfield } from './starfield.js';
import { Sky } from './sky.js';
import { Spawner } from './spawner.js';
import { FX, shakeOffset } from './fx.js';
import { GameAudio } from './audio.js';
import { Explosion } from './explosion.js';
import { Markers } from './markers.js';

// ---------- Параметры отладки: ?debug=1 — FPS, ?t=24 — старт с указанного времени ----------
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const START_T = parseFloat(params.get('t') || '0') || 0;
const GOD = params.has('god');                 // неуязвимость
const AUTOSTART = params.has('autostart');     // старт без нажатия пробела
const DEMO = params.get('demo');               // blackhole | star | quasar — объект перед кораблём, мир стоит
const SIM = parseFloat(params.get('sim') || '0') || 0; // прогнать N секунд логики до первого кадра (для тестов)
const T_LIGHT = CFG.T_LIGHT;

// ---------- Рендерер и сцена ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(CFG.FOV[0], innerWidth / innerHeight, 0.1, 6000);
camera.position.set(0, 2.3, CFG.CAM_Z);

scene.add(new THREE.AmbientLight(0x334466, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(5, 8, 6); scene.add(sun);
const rim = new THREE.DirectionalLight(0x7a8cff, 1.6); rim.position.set(-6, 2, -10); scene.add(rim);
const giantLight = new THREE.PointLight(0xffaa66, 0, 0, 0); scene.add(giantLight);

const sky = new Sky(); scene.add(sky.mesh);
const stars = new Starfield({ count: 5000, rMin: 30, rMax: 650, depth: 3000, near: 20, bright: 1.4 });
const dust = new Starfield({ count: 700, rMin: 3, rMax: 45, depth: 400, near: 15, bright: 0.8, pointSize: 0.6 });
scene.add(stars.group, dust.group);
const ship = new Ship(); scene.add(ship.group);
const spawner = new Spawner(scene);
const explosion = new Explosion(); scene.add(explosion.points);
const markers = new Markers(scene);
const giantList = Object.values(spawner.giants).flat();
for (const o of [stars.lines, stars.points, dust.lines, dust.points]) o.renderOrder = -5; // звёзды рисуем до гигантов
const fx = new FX(renderer, scene, camera);
fx.setSize(innerWidth, innerHeight, pixelRatio);
const audio = new GameAudio();

spawner.prewarm(renderer, camera);

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const hud = {
  root: $('hud'), speed: $('speed'), speedLabel: $('speedLabel'), bar: $('speedbar'),
  score: $('score'), best: $('best'), dist: $('dist'), warning: $('warning'),
  banner: $('banner'), bTitle: $('bannerTitle'), bSub: $('bannerSub'), popups: $('popups'),
};
let bannerTimer = 0;
function showBanner(title, sub, dur = 2.6) {
  hud.bTitle.textContent = title;
  hud.bSub.textContent = sub;
  hud.banner.classList.add('on');
  bannerTimer = dur;
}
function popup(text) {
  const el = document.createElement('div');
  el.className = 'popup';
  el.textContent = text;
  hud.popups.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}
function fmtDist(km) {
  if (km < 1e6) return Math.floor(km).toLocaleString('ru-RU') + ' км';
  if (km < 1.496e8) return (km / 1e6).toFixed(2) + ' млн км';
  return (km / 1.496e8).toFixed(3) + ' а.е.';
}

const loadBest = () => { try { return +localStorage.getItem('lightspeed_best') || 0; } catch { return 0; } };
const saveBest = (v) => { try { localStorage.setItem('lightspeed_best', String(v)); } catch { /* приватный режим */ } };

// ---------- Состояние ----------
const S = {
  mode: 'menu', paused: false, time: 0,
  t: 0, sp: speedAt(0), visFrac: 0.1, warpVis: 0,
  dist: 0, score: 0, best: loadBest(), lightReached: false,
  flash: 0, flashColor: new THREE.Color(1, 1, 1), shakeT: 0,
  death: null, deathT: 0, deathV: 0,
  banners: [],
};
$('menuBest').textContent = S.best;
hud.best.textContent = S.best;

const BANNERS = [
  { t: 0.3, title: 'ПОЛЕ АСТЕРОИДОВ', sub: 'Уклоняйся от обломков' },
  { t: CFG.PHASE2_T, title: 'УСКОРЕНИЕ', sub: 'Плотность потока растёт' },
  { t: T_LIGHT - 5, title: '→ c', sub: 'Приближаемся к скорости света' },
  { t: T_LIGHT + 35, title: 'ГЛУБОКИЙ КОСМОС', sub: 'Аномалии встречаются всё чаще' },
];

const CAUSES = {
  asteroid: 'Столкновение с астероидом.',
  debris: 'Столкновение с космическим мусором.',
  star: 'Корабль сгорел в короне звезды.',
  jet: 'Корабль испарила релятивистская струя квазара.',
  blackhole: 'Вас затянуло за горизонт событий. Оттуда не возвращается даже свет.',
  quasar: 'Вас поглотила сверхмассивная чёрная дыра в сердце квазара.',
};

function resetFx() {
  const u = fx.u;
  u.uSwirl.value = 0; u.uLens.value = 0; u.uRedshift.value = 0; u.uDark.value = 0; u.uFlash.value = 0;
  S.flash = 0; S.shakeT = 0;
}

function startGame() {
  audio.init();
  audio.click();
  spawner.reset();
  ship.reset();
  resetFx();
  S.mode = 'play';
  S.paused = false;
  S.t = START_T;
  S.sp = speedAt(S.t);
  S.lightReached = S.t >= T_LIGHT;
  S.dist = 0; S.score = 0;
  S.death = null;
  S.banners = BANNERS.filter((b) => b.t >= S.t).map((b) => ({ ...b }));
  $('menu').classList.add('hidden');
  $('over').classList.add('hidden');
  $('paused').classList.add('hidden');
  hud.root.classList.remove('hidden');
}

function gameOver() {
  S.mode = 'over';
  resetFx();
  ship.group.visible = false;
  hud.warning.classList.remove('on');
  const score = Math.floor(S.score);
  const record = score > S.best;
  if (record) { S.best = score; saveBest(score); }
  hud.best.textContent = S.best;
  $('menuBest').textContent = S.best;
  $('overCause').textContent = CAUSES[S.death.cause] || '';
  $('overTitle').textContent = S.death.kind === 'suck' ? 'ПОГЛОЩЁН' : 'КОРАБЛЬ УНИЧТОЖЕН';
  $('overScore').textContent = score;
  $('overDist').textContent = fmtDist(S.dist);
  $('overTime').textContent = S.t.toFixed(1) + ' с';
  $('newRecord').classList.toggle('hidden', !record);
  $('over').classList.remove('hidden');
}

const _v = new THREE.Vector3();
function startExplode(cause) {
  S.mode = 'dying';
  S.death = { kind: 'explode', cause };
  S.deathT = 0;
  S.deathV = S.sp.v;
  const p = ship.group.position;
  ship.group.visible = false;
  const palettes = {
    star: { c1: [1, 0.95, 0.7], c2: [1, 0.5, 0.1], flash: [1.2, 0.8, 0.4] },
    jet: { c1: [0.7, 0.8, 1.0], c2: [0.7, 0.3, 1.0], flash: [0.7, 0.7, 1.4] },
    default: { c1: [1, 0.75, 0.35], c2: [1, 0.25, 0.05], flash: [1.0, 0.55, 0.25] },
  };
  const pal = palettes[cause] || palettes.default;
  explosion.burst(p, { count: 500, speed: 28, c1: pal.c1, c2: pal.c2, life: 1.8 });
  explosion.burst(p, { count: 150, speed: 8, c1: [1, 1, 1], c2: pal.c1, life: 0.8 });
  S.flash = 0.45;
  S.flashColor.setRGB(...pal.flash);
  S.shakeT = 1.6;
  audio.explode();
  hud.warning.classList.remove('on');
}

function startSuck(obj, cause) {
  S.mode = 'dying';
  const c = obj.group.position, p = ship.group.position;
  const rel = _v.subVectors(p, c).clone();
  S.death = {
    kind: 'suck', cause, obj, relZ: rel.z,
    r0: Math.max(Math.hypot(rel.x, rel.y), 0.5),
    ang0: Math.atan2(rel.y, rel.x),
    cam0: camBase.clone(),
  };
  S.deathT = 0;
  S.deathV = S.sp.v;
  S.shakeT = 0.6;
  audio.suck();
  hud.warning.classList.remove('on');
}

input.onPress((code) => {
  audio.init();
  if (code === 'Space' || code === 'Enter') {
    if (S.mode === 'menu' || (S.mode === 'over')) startGame();
  } else if (code === 'KeyP' || code === 'Escape') {
    if (S.mode === 'play') {
      S.paused = !S.paused;
      $('paused').classList.toggle('hidden', !S.paused);
      if (audio.ctx) S.paused ? audio.ctx.suspend() : audio.ctx.resume();
    }
  } else if (code === 'KeyM') {
    audio.setMuted(!audio.muted);
    popup(audio.muted ? 'ЗВУК ВЫКЛ' : 'ЗВУК ВКЛ');
  }
});

// ---------- Камера ----------
const camBase = new THREE.Vector3(0, 2.3, CFG.CAM_Z);
const camLook = new THREE.Vector3();
const shakeV = new THREE.Vector3();
const projV = new THREE.Vector3();
const ZERO = new THREE.Vector3();

function toScreen(p, out) {
  projV.copy(p).project(camera);
  out.set(projV.x * 0.5 + 0.5, projV.y * 0.5 + 0.5);
  return out;
}

// ---------- Обновление ----------
function update(dt) {
  const mode = S.mode;

  // Скорость
  if (mode === 'play' && DEMO) {
    S.sp = { frac: 0.2, warp: 1, v: 0, dfrac: 0 };
  } else if (mode === 'play') {
    S.t += dt;
    S.sp = speedAt(S.t);
  } else if (mode === 'menu') {
    S.sp = { frac: 0.12, warp: 1, v: 40, dfrac: 0 };
  } else if (mode === 'dying') {
    S.deathT += dt;
    const k = S.death.kind === 'suck' ? 6 : 2.5;
    S.sp = { frac: S.sp.frac, warp: S.sp.warp, v: S.deathV * Math.exp(-S.deathT * k), dfrac: 0 };
  } else {
    S.sp = { frac: 0.06, warp: 1, v: 15, dfrac: 0 };
  }
  const sp = S.sp;
  const targetFrac = mode === 'dying' ? sp.frac * Math.exp(-S.deathT * 1.5) : sp.frac;
  S.visFrac = lerp(S.visFrac, targetFrac, 1 - Math.exp(-(mode === 'play' ? 8 : 2) * dt));
  S.warpVis = lerp(S.warpVis, S.lightReached && mode === 'play' ? 1 : 0, 1 - Math.exp(-2 * dt));
  const vf = S.visFrac;

  // Выход на скорость света
  if (mode === 'play' && !S.lightReached && S.t >= T_LIGHT) {
    S.lightReached = true;
    S.flash = 1.3;
    S.flashColor.setRGB(0.85, 0.9, 1.0);
    S.shakeT = 1.4;
    audio.boom();
    showBanner('СКОРОСТЬ СВЕТА', 'Впереди — чёрные дыры, звёзды и квазары', 3.2);
  }
  if (mode === 'play') {
    while (S.banners.length && S.t >= S.banners[0].t) {
      const b = S.banners.shift();
      showBanner(b.title, b.sub);
    }
  }

  // Преграды
  const sPos = ship.group.position;
  const res = spawner.update({
    dt, t: mode === 'play' ? S.t : 0, v: sp.v, ship: sPos, shipR: CFG.SHIP.hitR,
    spawning: (mode === 'play' && !DEMO) || mode === 'menu', decorOnly: mode === 'menu', collide: mode === 'play' && !GOD && !DEMO,
  }, camera);

  if (mode === 'play') {
    ship.update(dt, input.axisX(), input.axisY(), res.pull, sp.frac, sp.warp);
    S.dist += sp.frac * sp.warp * 299792.458 * dt;
    S.score += dt * (10 + 90 * sp.frac) * sp.warp;
    for (const o of res.nearMiss) {
      S.score += CFG.NEAR_MISS_BONUS;
      popup(`БЛИЗКИЙ ПРОЛЁТ  +${CFG.NEAR_MISS_BONUS}`);
      audio.whoosh();
      S.shakeT = Math.max(S.shakeT, 0.4);
    }
    hud.warning.classList.toggle('on', res.pullMag > 16);
    if (res.hit) {
      const k = res.hit.kind;
      if (k === 'blackhole' || k === 'quasar') startSuck(res.hit.obj, k);
      else startExplode(k);
    }
  } else if (mode === 'menu') {
    ship.update(dt, 0, 0, ZERO, 0.12, 1);
  }

  // Смерть
  const u = fx.u;
  if (S.mode === 'dying') {
    const d = S.death;
    if (d.kind === 'suck') {
      const p = clamp(S.deathT / 3.2, 0, 1);
      const e = p * p * (3 - 2 * p);
      const c = d.obj.group.position;
      const r = d.r0 * (1 - e);
      const ang = d.ang0 + p * p * 14;
      sPos.set(c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r, c.z + d.relZ * (1 - e));
      // Спагеттификация: корабль вытягивается к центру
      ship.model.rotation.set(0, 0, 0);
      ship.model.scale.set(0.85 * (1 - 0.85 * e), 0.85 * (1 - 0.85 * e), 0.85 * (1 + 6 * e));
      ship.group.lookAt(c);
      ship.group.rotateY(Math.PI);
      ship.animateEngines(dt, 0.3, 1);
      camBase.lerpVectors(d.cam0, _v.set(c.x * 0.7, c.y * 0.7 + 1, c.z + d.obj.killR * 2.2 + 3), e * 0.65);
      toScreen(c, u.uCenter.value);
      u.uSwirl.value = e * 3.2;
      u.uLens.value = e * 2.0;
      u.uRedshift.value = e * 0.85;
      u.uDark.value = smoothstep(0.7, 1.0, p);
      if (S.deathT > 3.6) gameOver();
    } else if (S.deathT > 2.3) {
      gameOver();
    }
  }

  // Камера и тряска
  if (S.mode !== 'dying' || S.death.kind !== 'suck') {
    camBase.lerp(_v.set(sPos.x * 0.55, sPos.y * 0.55 + 2.3, CFG.CAM_Z), 1 - Math.exp(-10 * dt));
  }
  let amp = 0;
  if (mode === 'play') {
    amp += S.lightReached ? 0.035 + 0.012 * (sp.warp - 1) : 0.015 + sp.dfrac * 1.9; // дрожание при разгоне
    amp += clamp(res.pullMag / 60, 0, 1) * 0.18;
  }
  amp += S.shakeT * 0.45;
  S.shakeT *= Math.exp(-dt * 2.8);
  camera.position.copy(camBase).add(shakeOffset(S.time, amp, shakeV));
  if (S.mode === 'dying' && S.death.kind === 'suck') {
    camera.lookAt(S.death.obj.group.position);
  } else {
    camLook.set(sPos.x * 0.75, sPos.y * 0.75 + 0.6, -40);
    camera.lookAt(camLook);
    camera.rotateZ(-ship.vel.x * 0.004 + shakeV.x * 0.02);
  }
  const fov = lerp(CFG.FOV[0], CFG.FOV[1], vf * vf) + Math.min(10, (sp.warp - 1) * 4) * S.warpVis;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

  // Небо, звёзды, частицы
  sky.update(camera, Math.min(0.75, 0.68 * vf * vf * vf + 0.06 * Math.min(1, sp.warp - 1) * S.warpVis), S.time);
  const vStar = sp.v * (1 + 10 * vf * vf * vf) * sp.warp;
  stars.update(vStar * dt, 0.5 + Math.pow(vf, 4) * 900 * Math.sqrt(sp.warp), S.warpVis, S.time, 1 - smoothstep(0.3, 0.8, vf));
  dust.update(sp.v * (1 + 2 * vf * vf) * dt, 0.3 + sp.v * 0.02 * (1 + 4 * vf * vf), S.warpVis * 0.6, S.time, 1 - smoothstep(0.2, 0.6, vf));
  explosion.update(dt);
  markers.update(dt, giantList, sPos.z, S.mode === 'play');

  // Свет от ближайшего гиганта
  if (res.nearest && res.nearest.lightColor) {
    giantLight.position.copy(res.nearest.group.position);
    giantLight.color.copy(res.nearest.lightColor);
    giantLight.intensity = 3.5 * smoothstep(900, 60, res.nearestDist);
  } else giantLight.intensity = 0;

  // Постобработка
  toScreen(_v.set(sPos.x * 0.75, sPos.y * 0.75, -2000), u.uVanish.value);
  toScreen(sPos, u.uShip.value);
  u.uBlur.value = Math.min(0.14, vf * vf * vf * 0.06 + S.warpVis * (0.045 + 0.01 * (sp.warp - 1)));
  u.uAberr.value = 0.002 + vf * vf * 0.012 + clamp(res.pullMag / 60, 0, 1) * 0.01 + S.shakeT * 0.006;
  fx.bloom.strength = 0.6 + vf * 0.4;
  S.flash *= Math.exp(-dt * 2.2);
  u.uFlash.value = S.flash;
  u.uFlashColor.value.copy(S.flashColor);

  audio.update(vf, sp.warp, res.pullMag / 50, S.mode);
  updateHud(dt);
}

function updateHud(dt) {
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) hud.banner.classList.remove('on');
  }
  if (S.mode !== 'play' && S.mode !== 'dying') return;
  const sp = S.sp;
  if (sp.frac < 1) {
    hud.speedLabel.textContent = 'СКОРОСТЬ';
    hud.speed.textContent = (sp.frac * 100).toFixed(sp.frac > 0.9 ? 2 : 1) + '% c';
  } else {
    hud.speedLabel.textContent = 'ВАРП';
    hud.speed.textContent = 'c × ' + sp.warp.toFixed(2);
  }
  hud.root.classList.toggle('warp', sp.frac >= 1);
  hud.bar.style.width = Math.min(100, sp.frac * 100) + '%';
  hud.score.textContent = Math.floor(S.score);
  hud.dist.textContent = fmtDist(S.dist);
}

// ---------- Цикл, ресайз, авто-качество ----------
function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  for (const f of [stars, dust]) f.setViewHeight(innerHeight * pixelRatio);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  fx.setSize(innerWidth, innerHeight, pixelRatio);
}
addEventListener('resize', onResize);

onResize();
const fpsEl = $('fps');
if (DEBUG) fpsEl.classList.remove('hidden');
let fpsAcc = 0, fpsFrames = 0, warmup = 3;

function trackFps(dt) {
  fpsAcc += dt; fpsFrames++;
  warmup -= dt;
  if (fpsAcc >= 2) {
    const fps = fpsFrames / fpsAcc;
    if (DEBUG) fpsEl.textContent = `${fps.toFixed(0)} fps · pr ${pixelRatio.toFixed(2)} · t ${S.t.toFixed(1)}`;
    if (warmup <= 0 && fps < 45 && pixelRatio > 0.55) {
      pixelRatio = Math.max(0.55, pixelRatio * 0.85);
      renderer.setPixelRatio(pixelRatio);
      onResize();
    }
    fpsAcc = 0; fpsFrames = 0;
  }
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.paused) return;
  S.time += dt;
  update(dt);
  fx.render();
  trackFps(dt);
}
if (AUTOSTART || DEMO) startGame();
if (DEMO) {
  const z = { blackhole: -150, star: -160, quasar: -260 }[DEMO] ?? -200;
  spawner.spawnGiant(DEMO, z, { angle: 0.3, eMin: 6, eMax: 6 });
  // ?suck=1 — сразу запустить анимацию затягивания (проверка эффекта)
  if (params.has('suck')) { const g = giantList.find((o) => o.active); g.group.position.z = -30; startSuck(g, DEMO); }
}
for (let i = 0; i < SIM * 30; i++) { S.time += 1 / 30; update(1 / 30); }
requestAnimationFrame(frame);
