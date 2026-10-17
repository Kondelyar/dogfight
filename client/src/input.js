export function createInput(target) {
  const down = new Set();
  const justPressedSet = new Set();

  target.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    down.add(e.code);
    justPressedSet.add(e.code);
  });

  target.addEventListener('keyup', (e) => {
    down.delete(e.code);
  });

  return {
    isDown(code) {
      return down.has(code);
    },
    justPressed(code) {
      const pressed = justPressedSet.has(code);
      justPressedSet.delete(code);
      return pressed;
    },
  };
}
