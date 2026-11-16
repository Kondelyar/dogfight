import { describe, expect, it, vi } from 'vitest';
import { drawEntity, drawHud, drawStarfield, drawExplosion } from '../src/render/draw.ts';
import { createSprites } from '../src/render/sprites.ts';
import {
  createAsteroidSlot,
  createBulletSlot,
  createPickupSlot,
  createShipSlot,
  place,
} from '../src/render/slots.ts';
import type { Explosion } from '../src/effects.ts';

// canvas у jsdom немає, тому перевіряємо, які виклики робить код, на підробленому контексті
function fakeCtx() {
  return {
    fillStyle: '',
    font: '',
    filter: '',
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
  };
}

// єдине приведення на файл: підроблений контекст видаємо за справжній
const asCtx = (fake: ReturnType<typeof fakeCtx>): CanvasRenderingContext2D =>
  fake as unknown as CanvasRenderingContext2D;

const frames = { ship: { x: 0, y: 0, w: 64, h: 64 }, flame: { x: 64, y: 0, w: 64, h: 64 } };

function sprites() {
  const drawn: string[] = [];
  return {
    drawn,
    api: {
      draw: (_ctx: unknown, name: string) => {
        drawn.push(name);
      },
    },
  };
}

describe('drawEntity (switch по kind)', () => {
  it('малює кожен вид своїм спрайтом', () => {
    const ctx = fakeCtx();
    const s = sprites();
    const ship = createShipSlot();
    const bullet = createBulletSlot();
    const rock = createAsteroidSlot();
    const hunter = { ...createAsteroidSlot(), homing: true };
    const shield = createPickupSlot();
    const rapid = createPickupSlot();
    rapid.effect = 'rapidfire';

    for (const e of [ship, bullet, rock, hunter, shield, rapid])
      drawEntity(asCtx(ctx), e, 0.5, s.api);
    expect(s.drawn).toEqual(['ship', 'bullet', 'asteroid', 'hunter', 'shield', 'rapid']);
  });

  it('корабель із тягою малює ще й полум’я, чужий корабель міняє колір і потім скидає фільтр', () => {
    const ctx = fakeCtx();
    const s = sprites();
    const ship = { ...createShipSlot(), thrusting: true, isMe: false };
    drawEntity(asCtx(ctx), ship, 0, s.api);
    expect(s.drawn).toEqual(['flame', 'ship']);
    expect(ctx.filter).toBe('none');
  });

  it('позиція інтерполюється між prevPos і pos за alpha', () => {
    const ctx = fakeCtx();
    const calls: number[][] = [];
    const api = { draw: (_c: unknown, _n: string, x: number, y: number) => calls.push([x, y]) };
    const bullet = createBulletSlot();
    bullet.prevPos = { x: 0, y: 0 };
    bullet.pos = { x: 100, y: 50 };
    drawEntity(asCtx(ctx), bullet, 0.5, api);
    expect(calls).toEqual([[50, 25]]);
  });
});

describe('createSprites', () => {
  it('draw відомого кадру викликає drawImage з потрібним вирізом', () => {
    const ctx = fakeCtx();
    const sheet = document.createElement('canvas');
    createSprites(sheet, frames).draw(asCtx(ctx), 'ship', 10, 20, 1, 30);
    expect(ctx.translate).toHaveBeenCalledWith(10, 20);
    expect(ctx.rotate).toHaveBeenCalledWith(1);
    expect(ctx.drawImage).toHaveBeenCalledWith(sheet, 0, 0, 64, 64, -15, -15, 30, 30);
  });

  it('невідомий кадр мовчки пропускається, розмір 0 означає «як у кадру»', () => {
    const ctx = fakeCtx();
    const sheet = document.createElement('canvas');
    const sprites = createSprites(sheet, frames);
    sprites.draw(asCtx(ctx), 'nope', 0, 0, 0, 10);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    sprites.draw(asCtx(ctx), 'ship', 0, 0, 0, 0);
    expect(ctx.drawImage).toHaveBeenCalledWith(sheet, 0, 0, 64, 64, -32, -32, 64, 64);
  });
});

describe('place', () => {
  it('записує позицію і кут у слот без створення об’єктів', () => {
    const slot = createShipSlot();
    const pos = slot.pos;
    place(slot, 5, 6, 0.7);
    expect(slot.pos).toBe(pos);
    expect([slot.pos.x, slot.pos.y, slot.angle, slot.prevAngle]).toEqual([5, 6, 0.7, 0.7]);
  });
});

describe('drawHud (кеш рядків)', () => {
  const stats = { stepsPerSecond: 60, framesPerSecond: 144, frameMs: 6.94 };

  it('виводить шість рядків', () => {
    const ctx = fakeCtx();
    drawHud(asCtx(ctx), stats, { hp: 80, score: 120 }, { name: 'Ann', room: 'Arena' });
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual([
      'steps/s 60',
      'frames/s 144',
      'frame 6.94 ms',
      'hp 80',
      'score 120',
      'Ann @ Arena',
    ]);
  });

  it('при зміні числа перебудовує текст', () => {
    const ctx = fakeCtx();
    drawHud(asCtx(ctx), stats, { hp: 80, score: 120 }, { name: 'Ann', room: 'Arena' });
    ctx.fillText.mockClear();
    drawHud(asCtx(ctx), stats, { hp: 55, score: 120 }, { name: 'Ann', room: 'Arena' });
    expect(ctx.fillText.mock.calls[3]?.[0]).toBe('hp 55');
  });
});

describe('фон і вибухи', () => {
  it('зоряне небо: заливка фону і по прямокутнику на зірку', () => {
    const ctx = fakeCtx();
    drawStarfield(asCtx(ctx), 100, 100, [
      { x: 1, y: 2, size: 1 },
      { x: 3, y: 4, size: 2 },
    ]);
    expect(ctx.fillRect).toHaveBeenCalledTimes(3);
  });

  it('вибух малює частинки з прозорістю від ttl', () => {
    const ctx = fakeCtx();
    const e: Explosion = {
      pos: { x: 10, y: 10 },
      ttl: 0.3,
      particles: [{ offset: { x: 1, y: 2 }, vel: { x: 0, y: 0 } }],
    };
    drawExplosion(asCtx(ctx), e);
    expect(ctx.fillRect).toHaveBeenCalledWith(11, 12, 3, 3);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });
});
