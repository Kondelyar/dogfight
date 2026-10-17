export function createAudio() {
  const ctx = new AudioContext();
  const buffers = new Map();

  // браузер дозволяє звук лише після жесту користувача
  function unlock() {
    if (ctx.state === 'suspended') ctx.resume();
  }
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  function play(name, { volume = 0.5, rate = 1 } = {}) {
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
      bus.addEventListener('fired', () =>
        play('shoot', { volume: 0.25, rate: 0.9 + Math.random() * 0.2 }),
      );
      bus.addEventListener('hit', () => play('hit'));
      bus.addEventListener('exploded', () => play('explosion'));
    },
  };
}
