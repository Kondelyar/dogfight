import type { Input } from './input.ts';

interface TouchButton {
  label: string;
  code: string;
  className: string;
}

const BUTTONS: TouchButton[] = [
  { label: '◀', code: 'ArrowLeft', className: 'left' },
  { label: '▶', code: 'ArrowRight', className: 'right' },
  { label: '▲', code: 'ArrowUp', className: 'thrust' },
];

// Екранні кнопки для телефону: те саме, що клавіші (ArrowLeft/Right/Up), через спільний Input.
// FIRE вже є на сторінці. Показуємо їх лише на пристроях із дотиковим екраном.
export function mountTouchControls(root: HTMLElement, input: Input): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;

  root.replaceChildren();
  for (const { label, code, className } of BUTTONS) {
    const button = document.createElement('button');
    button.textContent = label;
    button.className = `touch ${className}`;
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      input.setDown(code, true);
    });
    for (const type of ['pointerup', 'pointercancel']) {
      button.addEventListener(type, () => input.setDown(code, false));
    }
    root.append(button);
  }
  root.hidden = false;
}
