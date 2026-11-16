import { describe, expect, it, vi } from 'vitest';
import { installCrashHandlers, type ProcessLike } from '../src/crash.ts';
import { createLogger } from '../src/logger.ts';

// підроблений process: збираємо підписників і виклики exit
function fakeProcess() {
  const listeners: {
    uncaughtException: ((err: Error) => void)[];
    unhandledRejection: ((r: unknown) => void)[];
  } = {
    uncaughtException: [],
    unhandledRejection: [],
  };
  const exit = vi.fn();
  const proc: ProcessLike = {
    on(event: 'uncaughtException' | 'unhandledRejection', listener: never) {
      if (event === 'uncaughtException') listeners.uncaughtException.push(listener);
      else listeners.unhandledRejection.push(listener);
      return proc;
    },
    exit,
  };
  return { proc, listeners, exit };
}

function capture() {
  const lines: string[] = [];
  const log = createLogger(
    { logLevel: 'info', gitSha: 'test' },
    { write: (s: string) => void lines.push(s) },
  );
  return { log, lines };
}

describe('installCrashHandlers: необроблені помилки не глушаться', () => {
  it('uncaughtException: запис fatal зі стеком і вихід з кодом 1', () => {
    const { proc, listeners, exit } = fakeProcess();
    const { log, lines } = capture();
    installCrashHandlers(log, proc);

    listeners.uncaughtException[0]?.(new Error('boom'));

    expect(exit).toHaveBeenCalledWith(1);
    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry.level).toBe('fatal');
    expect(entry.kind).toBe('uncaughtException');
    expect(entry.err.message).toBe('boom');
    expect(entry.err.stack).toContain('boom');
  });

  it('unhandledRejection теж логується і завершує процес', () => {
    const { proc, listeners, exit } = fakeProcess();
    const { log, lines } = capture();
    installCrashHandlers(log, proc);

    listeners.unhandledRejection[0]?.(new Error('rejected'));

    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.parse(lines[0] ?? '{}').kind).toBe('unhandledRejection');
  });

  it('відхилення не з Error (рядок) теж не губиться', () => {
    const { proc, listeners, exit } = fakeProcess();
    const { log, lines } = capture();
    installCrashHandlers(log, proc);
    listeners.unhandledRejection[0]?.('просто рядок');
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines).toHaveLength(1);
  });

  it('друга помилка під час виходу не дублює запис і не викликає exit двічі', () => {
    const { proc, listeners, exit } = fakeProcess();
    const { log, lines } = capture();
    installCrashHandlers(log, proc);
    listeners.uncaughtException[0]?.(new Error('one'));
    listeners.uncaughtException[0]?.(new Error('two'));
    listeners.unhandledRejection[0]?.(new Error('three'));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
  });

  it('обидва обробники справді встановлені', () => {
    const { proc, listeners } = fakeProcess();
    installCrashHandlers(capture().log, proc);
    expect(listeners.uncaughtException).toHaveLength(1);
    expect(listeners.unhandledRejection).toHaveLength(1);
  });
});
