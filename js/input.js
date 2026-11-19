// Клавиатура. Используем e.code — работает при любой раскладке (в т.ч. русской).
const keys = new Set();
const pressHandlers = [];
const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

addEventListener('keydown', (e) => {
  if (BLOCK.has(e.code)) e.preventDefault();
  if (!e.repeat) pressHandlers.forEach((fn) => fn(e.code));
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const has = (...codes) => codes.some((c) => keys.has(c));

export const input = {
  axisX: () => (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0),
  axisY: () => (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0),
  onPress: (fn) => pressHandlers.push(fn),
};
