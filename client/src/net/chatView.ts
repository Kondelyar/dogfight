import { CloseCode } from 'shared';
import type { Connection } from './connection.ts';

const CLOSE_REASONS: Record<number, string> = {
  [CloseCode.BAD_MESSAGE]: 'Сервер відхилив повідомлення',
  [CloseCode.ROOM_FULL]: 'Кімната заповнена',
  [CloseCode.RATE_LIMIT]: 'Забагато повідомлень, перепідключаюсь...',
  [CloseCode.NO_ROOM]: 'Такої кімнати вже немає',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

export function mountChat(root: HTMLElement, connection: Connection): void {
  const roster = el('p');
  const log = el('div');
  log.className = 'chat-log';
  const status = el('p');
  const input = el('input');
  input.placeholder = 'Enter - написати';
  input.maxLength = 200;

  root.replaceChildren(roster, log, status, input);
  root.hidden = false;

  // клавіші в полі вводу не мають керувати кораблем
  for (const type of ['keydown', 'keyup']) {
    input.addEventListener(type, (e) => e.stopPropagation());
  }

  input.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') input.blur();
    if (e.code !== 'Enter') return;
    const text = input.value.trim();
    if (text) connection.send({ type: 'chat', text });
    input.value = '';
    input.blur();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    }
  });

  connection.on('roster', (msg) => {
    roster.textContent = `У кімнаті: ${msg.players.join(', ')}`;
  });

  connection.on('chat', (msg) => {
    log.append(el('div', `${msg.from}: ${msg.text}`));
    while (log.children.length > 50) log.firstChild?.remove();
    log.scrollTop = log.scrollHeight;
  });

  connection.on('open', () => {
    status.textContent = '';
  });

  connection.on('close', ({ code }) => {
    status.textContent = CLOSE_REASONS[code] ?? 'Зв’язок втрачено, перепідключаюсь...';
  });
}
