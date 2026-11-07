import { TICK_MS, ARENA, wrapDelta, wrapAngle } from 'shared';

const WINDOW = 60; // скільки останніх знімків беремо для оцінки годинника сервера
const wrapTo = (v, size) => ((v % size) + size) % size;

function lerpRecord(a, b, t) {
  return {
    ...a,
    x: wrapTo(a.x + wrapDelta(b.x - a.x, ARENA.width) * t, ARENA.width),
    y: wrapTo(a.y + wrapDelta(b.y - a.y, ARENA.height) * t, ARENA.height),
    angle: a.angle + wrapAngle(b.angle - a.angle) * t,
  };
}

// Чужі сутності малюємо трохи в минулому: між двома знімками, що оточують (зараз - delay).
export class Interpolator {
  delay = 2 * TICK_MS; // ~67 мс: два інтервали знімків
  #snapshots = [];
  #samples = [];
  #offset = 0; // серверний час мінус локальний

  reset() {
    this.#snapshots = [];
    this.#samples = [];
  }

  push(snapshot, now) {
    const time = snapshot.tick * TICK_MS;

    // найменш затриманий пакет найточніше показує різницю годинників
    this.#samples.push(time - now);
    if (this.#samples.length > WINDOW) this.#samples.shift();
    this.#offset = Math.max(...this.#samples);

    this.#snapshots.push({ time, entities: new Map(snapshot.entities.map((e) => [e.id, e])) });

    const renderTime = now + this.#offset - this.delay;
    while (this.#snapshots.length > 2 && this.#snapshots[1].time < renderTime - 500) {
      this.#snapshots.shift();
    }
  }

  sample(now) {
    const s = this.#snapshots;
    if (s.length === 0) return [];

    const renderTime = now + this.#offset - this.delay;
    let i = s.length - 1;
    while (i > 0 && s[i].time > renderTime) i--;

    const a = s[i];
    const b = s[i + 1];
    if (!b) return [...a.entities.values()]; // знімки закінчились: стоїмо на останньому, не екстраполюємо

    const t = Math.min(Math.max((renderTime - a.time) / (b.time - a.time), 0), 1);
    const out = [];
    // були в a, нема в b: показуємо на місці, поки renderTime не перейде за b.
    // з'явились у b: з'являться, коли renderTime дійде до b
    for (const [id, ra] of a.entities) {
      const rb = b.entities.get(id);
      out.push(rb ? lerpRecord(ra, rb, t) : ra);
    }
    return out;
  }
}
