import * as THREE from 'three';
import { CFG } from './config.js';
import { rand, randSign, lerp, clamp } from './util.js';
import { Asteroid, Debris } from './obstacles/asteroid.js';
import { BlackHole } from './obstacles/blackhole.js';
import { Star } from './obstacles/star.js';
import { Quasar } from './obstacles/quasar.js';

// Управляет пулами преград, спавном по фазам, коллизиями, гравитацией и «близкими пролётами».
export class Spawner {
  constructor(scene) {
    this.scene = scene;
    this.asteroids = Array.from({ length: 90 }, () => new Asteroid());
    this.decor = Array.from({ length: 90 }, () => new Asteroid()); // фоновые, вне коридора
    this.debris = Array.from({ length: 16 }, () => new Debris());
    this.giants = {
      blackhole: [new BlackHole(), new BlackHole(), new BlackHole()],
      star: [new Star(), new Star()],
      quasar: [new Quasar(), new Quasar()],
    };
    this.all = [...this.asteroids, ...this.decor, ...this.debris, ...Object.values(this.giants).flat()];
    for (const o of this.all) scene.add(o.group);
    this.pullVec = new THREE.Vector3();
    this.reset();
  }

  // Компилируем все шейдеры заранее, чтобы не было фризов при первом появлении чёрной дыры
  prewarm(renderer, camera) {
    for (const o of this.all) {
      o.group.visible = true;
      o.group.position.set(0, 0, -200);
    }
    renderer.compile(this.scene, camera);
    for (const o of this.all) o.group.visible = false;
  }

  reset() {
    for (const o of this.all) if (o.active) o.deactivate();
    for (const o of this.all) o.group.visible = false;
    this.astTimer = 1.5;
    this.decoTimer = 0;
    this.giantTimer = 1.8;
    this.lastGiant = null;
  }

  get(pool) { return pool.find((o) => !o.active); }

  spawnAsteroid(z, phase, ship, decorative = false) {
    const a = this.get(decorative ? this.decor : this.asteroids);
    if (!a) return;
    const B = CFG.BOUNDS;
    let x, y, r;
    if (decorative) {
      const ang = rand(0, Math.PI * 2), d = rand(20, 90);
      x = Math.cos(ang) * d; y = Math.sin(ang) * d * 0.7;
      r = rand(1.5, 7);
    } else {
      r = phase === 1 ? rand(1.0, 2.6) : rand(1.4, 4.2);
      if (Math.random() < 0.45) { // целимся в игрока
        x = ship.x + rand(-2.5, 2.5);
        y = ship.y + rand(-2, 2);
      } else {
        x = rand(-B.x - 4, B.x + 4);
        y = rand(-B.y - 3, B.y + 3);
      }
    }
    a.reset({ x, y, z: z - rand(0, 80), r, collidable: !decorative });
  }

  spawnDebris(z, ship) {
    const d = this.get(this.debris);
    if (!d) return;
    d.reset({ x: ship.x + rand(-6, 6), y: ship.y + rand(-4, 4), z, r: rand(0.9, 1.6) });
  }

  // Позиция гиганта так, чтобы он перекрывал часть коридора, но оставлял проход
  placeOffset(killR, eMin, eMax, angle = rand(0, Math.PI * 2)) {
    const e = rand(eMin, eMax);      // расстояние от центра коридора до края объекта
    const d = killR + e;
    return { x: Math.cos(angle) * d, y: Math.sin(angle) * d * 0.75, angle };
  }

  spawnGiant(type, z, opts = {}) {
    const o = this.get(this.giants[type]);
    if (!o) return false;
    if (type === 'blackhole') {
      const rs = rand(3.2, 5.0);
      const killR = 2.6 * rs * 0.9;
      const p = this.placeOffset(killR, opts.eMin ?? -4, opts.eMax ?? 3, opts.angle);
      o.reset({ x: p.x, y: p.y, z, rs });
    } else if (type === 'star') {
      const R = rand(9, 17);
      const p = this.placeOffset(R * 1.06, opts.eMin ?? -5, opts.eMax ?? 2.5, opts.angle);
      o.reset({ x: p.x, y: p.y, z, R });
    } else {
      // Ядро — за пределами коридора, джет пересекает коридор под углом
      const ang = opts.angle ?? rand(0, Math.PI * 2);
      const dist = rand(26, 40);
      const cx = Math.cos(ang) * dist, cy = Math.sin(ang) * dist * 0.75;
      const toC = new THREE.Vector2(-cx, -cy).normalize();
      const off = Math.asin(clamp(rand(0, 5) / dist, -1, 1)) * randSign();
      const dir2 = toC.rotateAround(new THREE.Vector2(), off);
      const axis = new THREE.Vector3(dir2.x, dir2.y, rand(-0.25, 0.25)).normalize();
      o.reset({ x: cx, y: cy, z, axis, jetR: rand(0.85, 1.1) });
    }
    return true;
  }

  // ctx: { t, v, dt, ship (Vector3), shipR, spawning, menu }
  update(ctx, camera) {
    const { dt, t, v, ship } = ctx;
    const dz = v * dt;
    const res = { hit: null, pull: this.pullVec.set(0, 0, 0), pullMag: 0, nearMiss: [], nearest: null, nearestDist: Infinity };
    const T = CFG.T_LIGHT;

    // ---- Спавн ----
    if (ctx.spawning) {
      const phase = t < CFG.PHASE2_T ? 1 : t < T ? 2 : 3;
      const quiet = t > T - CFG.CLEAR_BEFORE_LIGHT && t < T + 1.5;

      this.decoTimer -= dt;
      if (this.decoTimer <= 0 && t < T + 2) {
        this.decoTimer = rand(0.18, 0.4);
        this.spawnAsteroid(CFG.SPAWN_Z, phase, ship, true);
      }

      if (phase < 3 && !quiet && !ctx.decorOnly) {
        this.astTimer -= dt;
        if (this.astTimer <= 0) {
          const k = phase === 1 ? t / CFG.PHASE2_T : (t - CFG.PHASE2_T) / (T - CFG.PHASE2_T);
          this.astTimer = phase === 1 ? lerp(0.95, 0.55, k) : lerp(0.45, 0.2, k);
          const n = phase === 2 && Math.random() < 0.35 ? 2 + Math.floor(Math.random() * 2) : 1;
          for (let i = 0; i < n; i++) this.spawnAsteroid(CFG.SPAWN_Z, phase, ship);
          if (Math.random() < (phase === 1 ? 0.18 : 0.12)) this.spawnDebris(CFG.SPAWN_Z - 30, ship);
        }
      }

      if (phase === 3 && t > T + 1.5 && !ctx.decorOnly) {
        this.giantTimer -= dt;
        if (this.giantTimer <= 0) {
          const k = t - T;
          this.giantTimer = Math.max(1.5, 3.6 - k * 0.045);
          const z = CFG.GIANT_Z;
          if (k > 18 && Math.random() < 0.3) {
            // «Ворота»: два гиганта с узким проходом между ними
            const ang = rand(0, Math.PI * 2);
            const a = Math.random() < 0.6 ? 'blackhole' : 'star';
            const b = Math.random() < 0.5 ? 'blackhole' : 'star';
            this.spawnGiant(a, z, { angle: ang, eMin: 2.5, eMax: 4.5 });
            this.spawnGiant(b, z - 40, { angle: ang + Math.PI, eMin: 2.5, eMax: 4.5 });
          } else {
            const r = Math.random();
            let type = r < 0.45 ? 'blackhole' : r < 0.75 ? 'star' : 'quasar';
            if (type === this.lastGiant && Math.random() < 0.5) type = type === 'blackhole' ? 'quasar' : 'blackhole';
            if (!this.spawnGiant(type, z)) this.spawnGiant('blackhole', z);
            this.lastGiant = type;
          }
        }
      }
    }

    // ---- Движение, коллизии, гравитация ----
    const camZ = camera.position.z;
    for (const o of this.all) {
      if (!o.active) continue;
      const z0 = o.group.position.z;
      o.update(dt, dz, camera);
      const z1 = o.group.position.z;

      if (z1 - o.extent > camZ + 15) { o.deactivate(); continue; }

      if (ctx.collide && !res.hit) {
        const reach = (o.giant ? o.extent : o.extent + 2) + Math.abs(dz);
        if (Math.abs(z1 - ship.z) < reach) {
          const steps = clamp(Math.ceil(Math.abs(dz) / 1.0), 1, 14);
          for (let s = 1; s <= steps && !res.hit; s++) {
            const kind = o.hitTest(ship, lerp(z0, z1, s / steps), ctx.shipR);
            if (kind) res.hit = { kind, obj: o };
          }
        }
      }

      if (o.giant) {
        if (ctx.collide) res.pullMag += o.pull(ship, res.pull);
        const dist = o.group.position.distanceTo(ship);
        if (dist < res.nearestDist && z1 < ship.z + 40) { res.nearestDist = dist; res.nearest = o; }
        // Близкий пролёт
        if (!o.passed && z0 < ship.z && z1 >= ship.z) {
          o.passed = true;
          const gap = o.gap(ship);
          if (gap > 0 && gap < CFG.NEAR_MISS_GAP && ctx.collide) res.nearMiss.push(o);
        }
      }
    }
    return res;
  }
}
