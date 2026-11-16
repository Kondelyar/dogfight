// Пул об'єктів: замість new на кожну кулю чи частинку беремо готовий об'єкт і повертаємо назад.
// Менше короткоживучих об'єктів - менше роботи для збирача сміття (GC).
export class Pool<T> {
  #free: T[] = [];
  #create: () => T;
  #max: number;
  /** скільки об'єктів пул створив за весь час (для тестів і метрик) */
  created = 0;

  constructor(create: () => T, { max = 4096 }: { max?: number } = {}) {
    this.#create = create;
    this.#max = max;
  }

  get available(): number {
    return this.#free.length;
  }

  // Після acquire об'єкт може містити старі дані: ініціалізує його той, хто бере.
  acquire(): T {
    const item = this.#free.pop();
    if (item !== undefined) return item;
    this.created += 1;
    return this.#create();
  }

  release(item: T): void {
    if (this.#free.length < this.#max) this.#free.push(item);
  }
}

// Покадровий пул: next() видає об'єкти по черзі, reset() на початку кадру "повертає" всі разом.
// Об'єкти живуть між кадрами і не виділяються знову, поки їх не більше, ніж було на піку.
export class FrameArena<T> {
  #items: T[] = [];
  #create: () => T;
  #used = 0;

  constructor(create: () => T) {
    this.#create = create;
  }

  get used(): number {
    return this.#used;
  }

  get capacity(): number {
    return this.#items.length;
  }

  reset(): void {
    this.#used = 0;
  }

  next(): T {
    let item = this.#items[this.#used];
    if (item === undefined) {
      item = this.#create();
      this.#items.push(item);
    }
    this.#used += 1;
    return item;
  }
}
