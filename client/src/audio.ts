import type { Emitter, WorldEvents } from 'shared';

export interface Audio {
  ctx: AudioContext;
  setBuffers(sounds: Record<string, AudioBuffer>): void;
  attach(bus: Emitter<WorldEvents>): void;
}

interface PlayOptions {
  volume?: number;
  rate?: number;
}

export function createAudio(): Audio {
  const ctx = new AudioContext();
  const buffers = new Map<string, AudioBuffer>();

  // браузер дозволяє звук лише після жесту користувача
  function unlock(): void {
    if (ctx.state === 'suspended') void ctx.resume();
  }
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  function play(name: string, { volume = 0.5, rate = 1 }: PlayOptions = {}): void {
    const buffer = buffers.get(name);
    if (!buffer || ctx.state !== 'running') return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start();
  }

  return {
    ctx,
    setBuffers(sounds) {
      for (const [name, buffer] of Object.entries(sounds)) buffers.set(name, buffer);
    },
    attach(bus) {
      bus.on('fired', () => play('shoot', { volume: 0.25, rate: 0.9 + Math.random() * 0.2 }));
      bus.on('hit', () => play('hit'));
      bus.on('exploded', () => play('explosion'));
    },
  };
}
