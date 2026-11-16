export interface Input {
  isDown(code: string): boolean;
  justPressed(code: string): boolean;
}

export function createInput(target: Window): Input {
  const down = new Set<string>();
  const justPressedSet = new Set<string>();

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
