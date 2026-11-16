import {
  TICK_MS,
  ARENA,
  Pool,
  wrapDelta,
  wrapAngle,
  type EntityId,
  type EntityRecord,
  type Snapshot,
} from 'shared';

const WINDOW = 60; // скільки останніх знімків беремо для оцінки годинника сервера

const wrapTo = (v: number, size: number): number => ((v % size) + size) % size;

// Інтерполяція по колу: найкоротшим шляхом через край арени.
export const lerpX = (a: number, b: number, t: number): number =>
  wrapTo(a + wrapDelta(b - a, ARENA.width) * t, ARENA.width);
export const lerpY = (a: number, b: number, t: number): number =>
  wrapTo(a + wrapDelta(b - a, ARENA.height) * t, ARENA.height);
export const lerpAngleBetween = (a: number, b: number, t: number): number =>
  a + wrapAngle(b - a) * t;

// Викликається для кожної сутності кадру: a - запис до моменту показу, b - запис після нього
// (або undefined, якщо сутності там немає / знімки закінчились), t - частка між ними.
export type SampleVisitor = (a: EntityRecord, b: EntityRecord | undefined, t: number) => void;

interface TimedSnapshot {
  time: number;
  list: readonly EntityRecord[];
  byId: Map<EntityId, EntityRecord>;
}

// Чужі сутності малюємо трохи в минулому: між двома знімками, що оточують (зараз - delay).
export class Interpolator {
  delay = 2 * TICK_MS; // ~67 мс: два інтервали знімків
  #snapshots: TimedSnapshot[] = [];
  #samples: number[] = [];
  #offset = 0; // серверний час мінус локальний
  // Map-и під знімки перевикористовуються: 30 знімків на секунду не створюють 30 нових Map
  #spare = new Pool<TimedSnapshot>(() => ({ time: 0, list: [], byId: new Map() }));

  reset(): void {
    for (const s of this.#snapshots) this.#recycle(s);
    this.#snapshots.length = 0;
    this.#samples.length = 0;
  }

  #recycle(s: TimedSnapshot): void {
    s.byId.clear();
    s.list = [];
    this.#spare.release(s);
  }

  push(snapshot: Snapshot, now: number): void {
    const time = snapshot.tick * TICK_MS;

    // найменш затриманий пакет найточніше показує різницю годинників
    this.#samples.push(time - now);
    if (this.#samples.length > WINDOW) this.#samples.shift();
    let offset = -Infinity;
    for (const sample of this.#samples) if (sample > offset) offset = sample;
    this.#offset = offset;

    const entry = this.#spare.acquire();
    entry.time = time;
    entry.list = snapshot.entities;
    for (const e of snapshot.entities) entry.byId.set(e.id, e);
    this.#snapshots.push(entry);

    const renderTime = now + this.#offset - this.delay;
    while (
      this.#snapshots.length > 2 &&
      (this.#snapshots[1]?.time ?? Infinity) < renderTime - 500
    ) {
      const old = this.#snapshots.shift();
      if (old) this.#recycle(old);
    }
  }

  // Без виділення пам'яті: віддає пари записів відвідувачу, а той сам рахує проміжні значення.
  visit(now: number, visitor: SampleVisitor): void {
    const s = this.#snapshots;
    if (s.length === 0) return;

    const renderTime = now + this.#offset - this.delay;
    let i = s.length - 1;
    while (i > 0 && (s[i]?.time ?? 0) > renderTime) i--;

    const a = s[i];
    if (!a) return;
    const b = s[i + 1];
    if (!b) {
      // знімки закінчились: стоїмо на останньому, не екстраполюємо
      for (const ra of a.list) visitor(ra, undefined, 0);
      return;
    }

    const t = Math.min(Math.max((renderTime - a.time) / (b.time - a.time), 0), 1);
    // були в a, нема в b: показуємо на місці, поки renderTime не перейде за b.
    // з'явились у b: з'являться, коли renderTime дійде до b
    for (const ra of a.list) visitor(ra, b.byId.get(ra.id), t);
  }

  // Зручна (але з алокаціями) версія для тестів: готові інтерпольовані записи.
  sample(now: number): EntityRecord[] {
    const out: EntityRecord[] = [];
    this.visit(now, (a, b, t) => {
      out.push(
        b
          ? {
              ...a,
              x: lerpX(a.x, b.x, t),
              y: lerpY(a.y, b.y, t),
              angle: lerpAngleBetween(a.angle, b.angle, t),
            }
          : a,
      );
    });
    return out;
  }
}
