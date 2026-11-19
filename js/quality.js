// Определение устройства и уровня качества графики.
// Шейдеры собираются при загрузке, поэтому уровень выбирается один раз; дальше
// автоподстройка FPS меняет только разрешение рендера.
const params = new URLSearchParams(location.search);
const ua = navigator.userAgent || '';
const iPadOS = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);

export const IS_MOBILE = params.has('mobile') || /Android|iPhone|iPod|iPad|Mobile/i.test(ua) || iPadOS;
export const IS_TOUCH = params.has('touch') || IS_MOBILE
  || (window.matchMedia && matchMedia('(pointer: coarse)').matches);

const TIERS = {
  high: { name: 'high', prMax: 1.5, prMin: 0.6, bhSteps: 150, fbmOct: 5, stars: 5000, dust: 700, blur: 10, bloomScale: 1, starSeg: [96, 64], astDetail: 4 },
  medium: { name: 'medium', prMax: 1.25, prMin: 0.55, bhSteps: 96, fbmOct: 4, stars: 3000, dust: 450, blur: 7, bloomScale: 0.5, starSeg: [64, 40], astDetail: 3 },
  low: { name: 'low', prMax: 0.9, prMin: 0.5, bhSteps: 64, fbmOct: 3, stars: 1800, dust: 300, blur: 5, bloomScale: 0.5, starSeg: [48, 32], astDetail: 3 },
};

function detect() {
  const forced = params.get('quality');
  if (TIERS[forced]) return TIERS[forced];
  if (!IS_MOBILE) return TIERS.high;
  // Слабые телефоны: мало ядер или памяти
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8; // Safari не сообщает — считаем достаточной
  return cores <= 4 || mem <= 3 ? TIERS.low : TIERS.medium;
}

export const Q = detect();
