import { describe, expect, it, vi } from 'vitest';
import { CloseCode, encodeServerMessage, entityId, tick } from 'shared';
import { Connection } from '../src/net/connection.ts';
import { mountChat } from '../src/net/chatView.ts';

function mount() {
  const root = document.createElement('div');
  root.hidden = true;
  document.body.append(root);
  const connection = new Connection('ws://unused');
  const send = vi.spyOn(connection, 'send').mockImplementation(() => {});
  mountChat(root, connection);
  const input = root.querySelector('input');
  if (!input) throw new Error('нема поля вводу');
  return { root, connection, send, input };
}

describe('mountChat (jsdom)', () => {
  it('показує панель і оновлює список гравців', () => {
    const { root, connection } = mount();
    expect(root.hidden).toBe(false);
    connection.emit('roster', { v: 1, type: 'roster', players: ['Ann', 'Bob'] });
    expect(root.textContent).toContain('У кімнаті: Ann, Bob');
  });

  it('повідомлення чату додаються в журнал, журнал обмежений 50 рядками', () => {
    const { root, connection } = mount();
    for (let i = 0; i < 60; i++) {
      connection.emit('chat', { v: 1, type: 'chat', from: 'Bob', text: `m${i}` });
    }
    const lines = root.querySelectorAll('.chat-log div');
    expect(lines).toHaveLength(50);
    expect(lines[49]?.textContent).toBe('Bob: m59');
  });

  it('Enter у полі шле повідомлення і чистить поле, порожнє не шле', () => {
    const { input, send } = mount();
    input.value = '  привіт  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    expect(send).toHaveBeenCalledWith({ type: 'chat', text: 'привіт' });
    expect(input.value).toBe('');

    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('клавіші в полі вводу не доходять до гри (stopPropagation)', () => {
    const { input } = mount();
    const onWindow = vi.fn();
    window.addEventListener('keydown', onWindow);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    window.removeEventListener('keydown', onWindow);
    expect(onWindow).not.toHaveBeenCalled();
  });

  it('Enter поза полем переносить фокус у поле', () => {
    const { input } = mount();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    expect(document.activeElement).toBe(input);
  });

  it('статус з’єднання: причина закриття зрозумілою мовою, open очищає', () => {
    const { root, connection } = mount();
    connection.emit('close', { code: CloseCode.ROOM_FULL });
    expect(root.textContent).toContain('Кімната заповнена');
    connection.emit('close', { code: 1006 });
    expect(root.textContent).toContain('Зв’язок втрачено');
    connection.emit('open', null);
    expect(root.textContent).not.toContain('Зв’язок втрачено');
  });

  it('сервер може надіслати повідомлення того самого формату (перевірка кодування)', () => {
    const text = encodeServerMessage({
      type: 'welcome',
      you: entityId(1),
      seed: 1,
      tick: tick(0),
      tickRate: 30,
    });
    expect(JSON.parse(text)).toMatchObject({ v: 1, type: 'welcome' });
  });
});
