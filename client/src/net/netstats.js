const HISTORY = 60;

// лічильники для netgraph: без DOM, тож їх можна читати й у тестах
export class NetStats {
  rtt = 0;
  snapshotAt = 0;
  pending = 0;
  correction = 0;
  corrections = []; // величина звірки на кожен знімок
  inBytesPerSec = 0;
  outBytesPerSec = 0;
  lag = { baseMs: 0, jitterMs: 0, drop: 0 };
  #timer;
  #last = { in: 0, out: 0 };

  constructor(connection) {
    this.#timer = setInterval(() => {
      this.inBytesPerSec = connection.bytesIn - this.#last.in;
      this.outBytesPerSec = connection.bytesOut - this.#last.out;
      this.#last = { in: connection.bytesIn, out: connection.bytesOut };
    }, 1000);
  }

  recordCorrection(pixels) {
    this.correction = pixels;
    this.corrections.push(pixels);
    if (this.corrections.length > HISTORY) this.corrections.shift();
  }

  snapshotAge(now) {
    return this.snapshotAt ? now - this.snapshotAt : 0;
  }

  dispose() {
    clearInterval(this.#timer);
  }
}
