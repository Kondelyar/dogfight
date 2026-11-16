import { describe, expect, it } from 'vitest';
import { isLocalHost, socketScheme, socketUrl } from '../src/net/url.ts';

describe('socketScheme: з публічної сторінки лише wss://', () => {
  it('https завжди дає wss', () => {
    expect(socketScheme({ protocol: 'https:', hostname: 'dogfight.example' })).toBe('wss');
    expect(socketScheme({ protocol: 'https:', hostname: 'localhost' })).toBe('wss');
  });

  it('http дозволений лише для локальної розробки', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'dev.localhost']) {
      expect(socketScheme({ protocol: 'http:', hostname })).toBe('ws');
    }
  });

  it('http на публічному хості відхиляється помилкою, а не мовчки відкриває ws://', () => {
    expect(() => socketScheme({ protocol: 'http:', hostname: 'dogfight.example' })).toThrow(
      /https/,
    );
    expect(() => socketScheme({ protocol: 'http:', hostname: '192.168.1.10' })).toThrow(/https/);
    expect(() => socketScheme({ protocol: 'http:', hostname: 'localhost.evil.com' })).toThrow(
      /https/,
    );
  });

  it('isLocalHost не плутає схожі імена', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('notlocalhost.com')).toBe(false);
  });
});

describe('socketUrl', () => {
  it('збирає адресу з хосту сторінки й додає query', () => {
    const page = { protocol: 'https:', hostname: 'game.example', host: 'game.example' };
    expect(socketUrl(page)).toBe('wss://game.example/ws');
    expect(socketUrl(page, 'lag=100')).toBe('wss://game.example/ws?lag=100');
    expect(socketUrl({ protocol: 'http:', hostname: 'localhost', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws',
    );
  });
});
