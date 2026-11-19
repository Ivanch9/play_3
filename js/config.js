// Все параметры баланса и тюнинга в одном месте.
export const CFG = {
  T_LIGHT: 25,          // секунд до «скорости света»
  PHASE2_T: 10,         // начало плотного поля астероидов
  CLEAR_BEFORE_LIGHT: 2.5, // пауза в спавне перед выходом на световую

  BOUNDS: { x: 12, y: 7 },
  SHIP: { accel: 95, damping: 4.2, maxV: 28, hitR: 0.75 },

  WORLD: {
    v0: 45,             // скорость сближения с объектами на старте (ед/с)
    vLight: 280,        // на световой
    vMax: 440,
    vGrowth: 0.01,      // рост скорости после световой (доля в секунду)
    warpRate: 0.03,     // рост «варп-множителя» после световой
  },

  SPAWN_Z: -1000,
  GIANT_Z: -1900,
  CAM_Z: 9.5,
  FOV: [62, 100],

  GRAVITY: { G: 46, range: 520 }, // сила притяжения ЧД и дальность, с которой она начинает тянуть
  NEAR_MISS_GAP: 3.0,
  NEAR_MISS_BONUS: 150,
};

// Кривая скорости: frac — доля скорости света (0..1), warp — множитель после световой, v — скорость мира.
export function speedAt(t) {
  const T = CFG.T_LIGHT, W = CFG.WORLD;
  if (t < T) {
    const x = Math.max(0, t) / T;
    return {
      frac: 0.03 + 0.97 * x * x,
      warp: 1,
      v: W.v0 + (W.vLight - W.v0) * Math.pow(x, 1.5),
      dfrac: (2 * 0.97 * x) / T,
    };
  }
  const k = t - T;
  return {
    frac: 1,
    warp: 1 + k * W.warpRate,
    v: Math.min(W.vMax, W.vLight * (1 + k * W.vGrowth)),
    dfrac: 0,
  };
}
