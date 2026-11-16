import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseCode, encodeServerMessage } from 'shared';
import { Connection } from '../src/net/connection.ts';
import { createInput } from '../src/input.ts';
import { mountTouchControls } from '../src/touch.ts';

class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  binaryType = 'blob';

  constructor(readonly url: string) {
    super();
    FakeSocket.instances.push(this);
  }

  send(): void {}
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  receive(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  closeWith(code: number): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code }));
  }
  fail(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event('error'));
    this.dispatchEvent(new CloseEvent('close', { code: 1006 }));
  }
}

const last = (): FakeSocket => {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('сокет не створено');
  return socket;
};

describe('Connection: зупинка сервера і втрата зв’язку', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('повідомлення shutdown доходить до слухача (новий тип обробляється)', () => {
    const c = new Connection('ws://test');
    const onShutdown = vi.fn();
    c.on('shutdown', onShutdown);
    c.connect();
    last().open();
    last().receive(encodeServerMessage({ type: 'shutdown', reason: 'deploy' }));
    expect(onShutdown).toHaveBeenCalledWith(expect.objectContaining({ reason: 'deploy' }));
  });

  it('закриття кодом 1001 це gaveUp(shutdown), перепідключення не буде', () => {
    const c = new Connection('ws://test');
    const gaveUp = vi.fn();
    c.on('gaveUp', gaveUp);
    c.connect();
    last().open();
    last().closeWith(CloseCode.SHUTDOWN);
    vi.advanceTimersByTime(60_000);
    expect(gaveUp).toHaveBeenCalledWith({ reason: 'shutdown', code: 1001 });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('відмова сервера (кімната повна) це gaveUp(refused)', () => {
    const c = new Connection('ws://test');
    const gaveUp = vi.fn();
    c.on('gaveUp', gaveUp);
    c.connect();
    last().open();
    last().closeWith(CloseCode.ROOM_FULL);
    expect(gaveUp).toHaveBeenCalledWith({ reason: 'refused', code: CloseCode.ROOM_FULL });
  });

  it('сервер убито: кілька спроб перепідключення, потім gaveUp(unreachable)', () => {
    const c = new Connection('ws://test');
    const gaveUp = vi.fn();
    c.on('gaveUp', gaveUp);
    c.connect();
    last().open();
    last().closeWith(1006); // обрив без закриття: сервер зник

    // кожна наступна спроба теж невдала
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(12_000);
      const socket = FakeSocket.instances.at(-1);
      if (socket && socket.readyState === 0) socket.fail();
    }
    expect(gaveUp).toHaveBeenCalledTimes(1);
    expect(gaveUp).toHaveBeenCalledWith({ reason: 'unreachable', code: null });
    // і більше сокетів не створюється
    const count = FakeSocket.instances.length;
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances.length).toBe(count);
  });

  it('вдале перепідключення скидає лічильник спроб', () => {
    const c = new Connection('ws://test');
    const gaveUp = vi.fn();
    c.on('gaveUp', gaveUp);
    c.connect();
    for (let round = 0; round < 6; round++) {
      last().open();
      last().closeWith(1006);
      vi.advanceTimersByTime(11_000);
    }
    expect(gaveUp).not.toHaveBeenCalled();
    expect(FakeSocket.instances.length).toBeGreaterThan(5);
  });
});

describe('екранні кнопки для телефону', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Input.setDown ставить і знімає клавішу так само, як справжня', () => {
    const input = createInput(window);
    input.setDown('ArrowUp', true);
    expect(input.isDown('ArrowUp')).toBe(true);
    expect(input.justPressed('ArrowUp')).toBe(true);
    expect(input.justPressed('ArrowUp')).toBe(false);
    input.setDown('ArrowUp', false);
    expect(input.isDown('ArrowUp')).toBe(false);
  });

  it('на пристрої з мишею кнопки не показуються', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const root = document.createElement('div');
    root.hidden = true;
    mountTouchControls(root, createInput(window));
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
  });

  it('на дотиковому екрані є три кнопки, що тиснуть клавіші ArrowLeft/Right/Up', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const root = document.createElement('div');
    root.hidden = true;
    const input = createInput(window);
    mountTouchControls(root, input);
    expect(root.hidden).toBe(false);
    const buttons = root.querySelectorAll('button');
    expect(buttons).toHaveLength(3);

    const thrust = root.querySelector('.thrust');
    expect(thrust).not.toBeNull();
    // у jsdom нема setPointerCapture
    if (thrust instanceof HTMLButtonElement) {
      thrust.setPointerCapture = () => {};
      thrust.dispatchEvent(new Event('pointerdown', { cancelable: true }));
      expect(input.isDown('ArrowUp')).toBe(true);
      thrust.dispatchEvent(new Event('pointerup'));
      expect(input.isDown('ArrowUp')).toBe(false);
    }
  });
});
