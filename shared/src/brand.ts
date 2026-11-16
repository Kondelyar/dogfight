// Branded-типи: у рантаймі це звичайні числа, а для tsc - різні типи.
// id не можна передати туди, де чекають seq, а seq - туди, де чекають номер кроку.
declare const tag: unique symbol;
export type Brand<T, B extends string> = T & { readonly [tag]: B };

export type EntityId = Brand<number, 'EntityId'>;
export type Seq = Brand<number, 'Seq'>; // номер інпуту клієнта (u32)
export type Seq16 = Brand<number, 'Seq16'>; // молодші 16 біт seq, як у знімку
export type Tick = Brand<number, 'Tick'>; // номер кроку симуляції

// Єдине місце, де звичайне число стає branded. Усе інше код бере вже готові значення.
function brand<B extends string>(n: number): Brand<number, B> {
  return n as Brand<number, B>; // as: бренд існує лише для tsc, у рантаймі це те саме число
}

export const entityId = (n: number): EntityId => brand<'EntityId'>(n);
export const seq = (n: number): Seq => brand<'Seq'>(n);
export const seq16 = (n: number): Seq16 => brand<'Seq16'>(n);
export const tick = (n: number): Tick => brand<'Tick'>(n);

export const NO_ENTITY = entityId(0);
export const toSeq16 = (s: Seq): Seq16 => seq16(s & 0xffff);

// Літеральні типи значень без `as const`: <const T> виводить { SHIP: 1 }, а не { SHIP: number }
export const defineConst = <const T extends Record<string, number>>(table: T): Readonly<T> => table;
export type ValueOf<T> = T[keyof T];

export type Result<T, E = string> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const fail = <E = string>(error: E): Result<never, E> => ({ ok: false, error });

// допоміжна функція для default-гілки вичерпного switch: новий варіант без обробника - помилка tsc
export function assertNever(value: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(value)}`);
}
