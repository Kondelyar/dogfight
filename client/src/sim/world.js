export class World extends EventTarget {
  #entities = new Map();
  #toDespawn = new Set();

  spawn(entity) {
    this.#entities.set(entity.id, entity);
    return entity;
  }

  despawn(id) {
    this.#toDespawn.add(id);
  }

  get(id) {
    return this.#entities.get(id);
  }

  get size() {
    return this.#entities.size;
  }

  [Symbol.iterator]() {
    return this.#entities.values();
  }

  *ofKind(kind) {
    for (const e of this) if (e.kind === kind) yield e;
  }

  // шина подій: сим кидає "fired" / "hit" / "exploded" / "scored",
  // а звук і HUD на них підписані й про сим нічого не знають
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  step(dt, ctx) {
    for (const e of this) {
      if (!e.alive) {
        this.despawn(e.id);
        continue;
      }
      e.update(dt, ctx.input, ctx.bounds, ctx);
      if (!e.alive) this.despawn(e.id);
    }

    // мутувати Map під час ітерації по ній можна, але це джерело
    // тонких багів - тому мертві лише позначаються, видалення окремим проходом
    for (const id of this.#toDespawn) {
      this.#entities.delete(id);
    }
    this.#toDespawn.clear();
  }
}
