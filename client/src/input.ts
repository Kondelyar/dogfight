export interface Input {
  // клавіші з екранних кнопок (телефон) йдуть тим самим шляхом, що й справжні
  setDown(code: string, down: boolean): void;
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
    setDown(code, isDown) {
      if (isDown) {
        down.add(code);
        justPressedSet.add(code);
      } else {
        down.delete(code);
      }
    },
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
