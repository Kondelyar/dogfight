const CLOSE_REASONS = {
  4000: 'Сервер відхилив повідомлення',
  4002: 'Кімната заповнена',
  4003: 'Забагато повідомлень, перепідключаюсь...',
  4005: 'Такої кімнати вже немає',
};

function el(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

export function mountChat(root, connection) {
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

  connection.addEventListener('roster', (e) => {
    roster.textContent = `У кімнаті: ${e.detail.players.join(', ')}`;
  });

  connection.addEventListener('chat', (e) => {
    log.append(el('div', `${e.detail.from}: ${e.detail.text}`));
    while (log.children.length > 50) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  });

  connection.addEventListener('open', () => {
    status.textContent = '';
  });

  connection.addEventListener('close', (e) => {
    status.textContent = CLOSE_REASONS[e.detail.code] ?? 'Зв’язок втрачено, перепідключаюсь...';
  });
}
