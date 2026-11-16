// Типізований emitter без DOM: M - таблиця "назва події -> тип даних".
// Працює однаково в Node і в браузері (EventTarget/CustomEvent тут не потрібні).
export type Listener<T> = (payload: T) => void;

export class Emitter<M extends object> {
  #listeners: { [K in keyof M]?: Set<Listener<M[K]>> } = {};

  on<K extends keyof M>(type: K, listener: Listener<M[K]>): () => void {
    (this.#listeners[type] ??= new Set()).add(listener);
    return () => this.off(type, listener);
  }

  off<K extends keyof M>(type: K, listener: Listener<M[K]>): void {
    this.#listeners[type]?.delete(listener);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.#listeners[type];
    if (!set) return;
    for (const listener of [...set]) listener(payload);
  }
}
