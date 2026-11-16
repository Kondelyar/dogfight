import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Lobby } from '../src/lobby/lobby.ts';
import { mountLobbyView } from '../src/lobby/lobbyView.ts';

const rooms = [
  { id: 'a1', name: 'Arena', players: 2, max: 8 },
  { id: 'b2', name: 'Full', players: 8, max: 8 },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Lobby', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('refresh отримує кімнати, перевіряє схемою й повідомляє підписників', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ rooms })),
    );
    const lobby = new Lobby();
    const changed = vi.fn();
    lobby.on('roomsChanged', changed);
    await lobby.refresh();
    expect(changed).toHaveBeenCalledWith(rooms);
    expect(lobby.rooms).toHaveLength(2);
  });

  it('невалідна відповідь сервера - це refreshFailed, а не зіпсований стан', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ rooms: [{ id: 5 }] })),
    );
    const lobby = new Lobby();
    const failed = vi.fn();
    lobby.on('refreshFailed', failed);
    await lobby.refresh();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(lobby.rooms).toEqual([]);
  });

  it('помилка мережі та 500 теж дають refreshFailed', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 400));
    vi.stubGlobal('fetch', fetchMock);
    const lobby = new Lobby();
    const failed = vi.fn();
    lobby.on('refreshFailed', failed);
    await lobby.refresh();
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('start оновлює список за таймером, stop зупиняє', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ rooms }));
    vi.stubGlobal('fetch', fetchMock);
    const lobby = new Lobby({ intervalMs: 1000 });
    lobby.start();
    lobby.start(); // повторний start нічого не подвоює
    await vi.advanceTimersByTimeAsync(3100);
    lobby.stop();
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(calls).toBeLessThanOrEqual(5);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('create шле POST з ім’ям і оновлює список', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({ room: rooms[0] }, 201) : jsonResponse({ rooms }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const lobby = new Lobby();
    await lobby.create('  Arena ');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[1]?.body).toBe(JSON.stringify({ name: 'Arena' }));
    expect(lobby.rooms).toHaveLength(2);
  });

  it('create з порожнім ім’ям не звертається до мережі', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const lobby = new Lobby();
    const failed = vi.fn();
    lobby.on('createFailed', failed);
    await lobby.create('   ');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith({ status: null });
  });

  it('429 від сервера потрапляє в createFailed зі статусом', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'too many rooms' }, 429)),
    );
    const lobby = new Lobby();
    const failed = vi.fn();
    lobby.on('createFailed', failed);
    await lobby.create('One');
    expect(failed).toHaveBeenCalledWith({ status: 429 });
  });

  it('join заходить лише в кімнату, де є місце', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ rooms })),
    );
    const lobby = new Lobby();
    await lobby.refresh();
    const joined = vi.fn();
    lobby.on('joined', joined);
    expect(lobby.join('b2', 'Ann')).toBe(false); // повна
    expect(lobby.join('zzz', 'Ann')).toBe(false); // нема такої
    expect(lobby.join('a1', 'Ann')).toBe(true);
    expect(joined).toHaveBeenCalledWith({ room: rooms[0], name: 'Ann' });
  });
});

describe('mountLobbyView (jsdom)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('малює список кімнат і блокує Join для повної', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ rooms })),
    );
    const root = document.createElement('div');
    const lobby = new Lobby();
    mountLobbyView(root, lobby);
    await lobby.refresh();
    const items = root.querySelectorAll('li');
    expect(items).toHaveLength(2);
    const buttons = root.querySelectorAll<HTMLButtonElement>('li button');
    expect(buttons[0]?.disabled).toBe(false);
    expect(buttons[1]?.disabled).toBe(true);
    expect(items[0]?.textContent).toContain('Arena — 2/8');
  });

  it('порожній список підказує створити кімнату, помилки показуються текстом', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ rooms: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const root = document.createElement('div');
    const lobby = new Lobby();
    const view = mountLobbyView(root, lobby);
    await lobby.refresh();
    expect(root.textContent).toContain('Кімнат ще немає');

    fetchMock.mockImplementation(async () => jsonResponse({}, 500));
    await lobby.refresh();
    expect(root.textContent).toContain('Не вдалося оновити список кімнат');

    view.setNotice('Не завантажилось: sounds/hit');
    expect(root.textContent).toContain('sounds/hit');
  });

  it('клік по Join викликає lobby.join з іменем пілота', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ rooms })),
    );
    const root = document.createElement('div');
    const lobby = new Lobby();
    mountLobbyView(root, lobby);
    await lobby.refresh();
    const joined = vi.fn();
    lobby.on('joined', joined);
    const name = root.querySelector('input');
    if (!name) throw new Error('нема поля імені');
    name.value = 'Maverick';
    root.querySelector<HTMLButtonElement>('li button')?.click();
    expect(joined).toHaveBeenCalledWith({ room: rooms[0], name: 'Maverick' });
  });
});
