function el(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

export function mountLobbyView(root, lobby) {
  const nameInput = el('input');
  nameInput.value = 'Pilot';
  nameInput.maxLength = 16;

  const nameLabel = el('label', "Ім'я пілота ");
  nameLabel.append(nameInput);

  const list = el('ul');

  const roomInput = el('input');
  roomInput.placeholder = 'Назва нової кімнати';
  roomInput.maxLength = 32;
  const createButton = el('button', 'Створити');
  createButton.addEventListener('click', () => {
    const name = roomInput.value.trim();
    if (!name) return;
    roomInput.value = '';
    lobby.create(name);
  });
  const createRow = el('div');
  createRow.append(roomInput, createButton);

  const status = el('p');
  const notice = el('p');

  const panel = el('div');
  panel.className = 'panel';
  panel.append(el('h1', 'dogfight'), nameLabel, list, createRow, status, notice);
  root.replaceChildren(panel);

  let lastKey = '';

  function render(rooms) {
    const key = JSON.stringify(rooms);
    if (key === lastKey) return;
    lastKey = key;

    if (rooms.length === 0) {
      list.replaceChildren(el('li', 'Кімнат ще немає, створи першу.'));
      return;
    }

    list.replaceChildren(
      ...rooms.map((room) => {
        const button = el('button', 'Join');
        button.disabled = room.players >= room.max;
        button.addEventListener('click', () => {
          lobby.join(room.id, nameInput.value.trim() || 'Pilot');
        });

        const li = el('li');
        li.append(el('span', `${room.name} — ${room.players}/${room.max} `), button);
        return li;
      }),
    );
  }

  lobby.addEventListener('roomsChanged', (e) => {
    status.textContent = '';
    render(e.detail);
  });

  lobby.addEventListener('refreshFailed', () => {
    status.textContent = 'Не вдалося оновити список кімнат, пробую ще раз...';
  });

  lobby.addEventListener('createFailed', (e) => {
    status.textContent =
      e.detail.status === 429 ? 'Забагато кімнат на сервері' : 'Не вдалося створити кімнату';
  });

  return {
    setNotice(text) {
      notice.textContent = text;
    },
  };
}
