// Ввод: клавиатура (e.code — работает при любой раскладке) и касания/мышь.
const keys = new Set();
const pressHandlers = [];
const tapHandlers = [];
const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

addEventListener('keydown', (e) => {
  if (BLOCK.has(e.code)) e.preventDefault();
  if (!e.repeat) pressHandlers.forEach((fn) => fn(e.code));
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); touch.active = false; });

// Касание: палец в любом месте экрана, корабль повторяет его смещение.
// sx/sy — точка начала касания, x/y — текущая; fresh — касание только что началось.
const touch = { active: false, id: null, sx: 0, sy: 0, x: 0, y: 0, fresh: false };
const isUi = (e) => e.target && e.target.closest && e.target.closest('button, a');

addEventListener('pointerdown', (e) => {
  if (isUi(e) || touch.active) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  touch.active = true;
  touch.id = e.pointerId;
  touch.sx = touch.x = e.clientX;
  touch.sy = touch.y = e.clientY;
  touch.fresh = true;
});
addEventListener('pointermove', (e) => {
  if (touch.active && e.pointerId === touch.id) { touch.x = e.clientX; touch.y = e.clientY; }
});
const end = (e) => {
  if (touch.active && e.pointerId === touch.id) touch.active = false;
  if (e.type === 'pointerup' && !isUi(e)) tapHandlers.forEach((fn) => fn(e));
};
addEventListener('pointerup', end);
addEventListener('pointercancel', end);

// Не даём браузеру прокручивать/масштабировать страницу жестами
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

const has = (...codes) => codes.some((c) => keys.has(c));

export const input = {
  axisX: () => (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0),
  axisY: () => (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0),
  onPress: (fn) => pressHandlers.push(fn),
  onTap: (fn) => tapHandlers.push(fn),
  touch,
};
