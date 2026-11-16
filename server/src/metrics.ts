import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks';

// Лічильники й виміри для /metrics. Формат - текст Prometheus (рядки "назва значення"):
// його читає і Prometheus, і людина в браузері.
export interface MetricsSource {
  players(): number;
  rooms(): number;
  connections(): number;
  // найгірші значення кроку серед усіх кімнат, мс
  tickMs(): { avg: number; p50: number; p95: number; p99: number; max: number };
  overruns(): number;
}

const RATE_WINDOW_MS = 5000;

export class Metrics {
  messagesIn = 0;
  messagesOut = 0;
  bytesIn = 0;
  bytesOut = 0;
  rejected = 0;
  badFrames = 0;
  connectionsTotal = 0;

  #source: MetricsSource;
  #loop: IntervalHistogram = monitorEventLoopDelay({ resolution: 10 });
  #elu = performance.eventLoopUtilization();
  #rates = { msgPerSec: 0, bytesInPerSec: 0, bytesOutPerSec: 0 };
  #last = { at: Date.now(), messages: 0, bytesIn: 0, bytesOut: 0 };
  #timer: NodeJS.Timeout | null = null;

  constructor(source: MetricsSource) {
    this.#source = source;
  }

  start(): void {
    this.#loop.enable();
    this.#timer = setInterval(() => this.#sampleRates(), RATE_WINDOW_MS);
    this.#timer.unref();
  }

  stop(): void {
    this.#loop.disable();
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  // Швидкість за останнє вікно: лічильники ростуть вічно, а "за секунду" зручніше читати одразу.
  #sampleRates(): void {
    const now = Date.now();
    const seconds = Math.max((now - this.#last.at) / 1000, 0.001);
    const messages = this.messagesIn + this.messagesOut;
    this.#rates = {
      msgPerSec: (messages - this.#last.messages) / seconds,
      bytesInPerSec: (this.bytesIn - this.#last.bytesIn) / seconds,
      bytesOutPerSec: (this.bytesOut - this.#last.bytesOut) / seconds,
    };
    this.#last = { at: now, messages, bytesIn: this.bytesIn, bytesOut: this.bytesOut };
  }

  // Сирий знімок значень (для тестів і JSON), render() перетворює його на текст.
  snapshot() {
    const tick = this.#source.tickMs();
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const elu = performance.eventLoopUtilization(this.#elu);
    this.#elu = performance.eventLoopUtilization();
    const ms = (ns: number): number => (Number.isFinite(ns) ? ns / 1e6 : 0);
    return {
      players: this.#source.players(),
      rooms: this.#source.rooms(),
      connections: this.#source.connections(),
      messagesIn: this.messagesIn,
      messagesOut: this.messagesOut,
      bytesIn: this.bytesIn,
      bytesOut: this.bytesOut,
      rejected: this.rejected,
      badFrames: this.badFrames,
      connectionsTotal: this.connectionsTotal,
      msgPerSec: this.#rates.msgPerSec,
      bytesInPerSec: this.#rates.bytesInPerSec,
      bytesOutPerSec: this.#rates.bytesOutPerSec,
      tick,
      overruns: this.#source.overruns(),
      loopDelayMeanMs: ms(this.#loop.mean),
      loopDelayP99Ms: ms(this.#loop.percentile(99)),
      loopDelayMaxMs: ms(this.#loop.max),
      loopUtilization: elu.utilization,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
      uptimeSeconds: process.uptime(),
      cpuSeconds: (cpu.user + cpu.system) / 1e6,
    };
  }

  render(): string {
    const s = this.snapshot();
    const lines: string[] = [];
    const metric = (
      name: string,
      type: 'gauge' | 'counter',
      help: string,
      value: number,
      labels = '',
    ): void => {
      lines.push(
        `# HELP ${name} ${help}`,
        `# TYPE ${name} ${type}`,
        `${name}${labels} ${format(value)}`,
      );
    };

    metric('dogfight_players', 'gauge', 'Players currently in rooms', s.players);
    metric('dogfight_rooms', 'gauge', 'Rooms currently open', s.rooms);
    metric('dogfight_connections', 'gauge', 'Open WebSocket connections', s.connections);
    metric(
      'dogfight_connections_total',
      'counter',
      'WebSocket connections accepted since start',
      s.connectionsTotal,
    );
    metric(
      'dogfight_messages_received_total',
      'counter',
      'Messages received from clients',
      s.messagesIn,
    );
    metric('dogfight_messages_sent_total', 'counter', 'Messages sent to clients', s.messagesOut);
    metric('dogfight_bytes_received_total', 'counter', 'Bytes received from clients', s.bytesIn);
    metric('dogfight_bytes_sent_total', 'counter', 'Bytes sent to clients', s.bytesOut);
    metric(
      'dogfight_messages_per_second',
      'gauge',
      'Messages in plus out per second (last 5 s)',
      s.msgPerSec,
    );
    metric(
      'dogfight_bytes_received_per_second',
      'gauge',
      'Bytes received per second (last 5 s)',
      s.bytesInPerSec,
    );
    metric(
      'dogfight_bytes_sent_per_second',
      'gauge',
      'Bytes sent per second (last 5 s)',
      s.bytesOutPerSec,
    );
    metric(
      'dogfight_rejected_total',
      'counter',
      'Connections refused at the handshake (origin, ip limit)',
      s.rejected,
    );
    metric(
      'dogfight_bad_frames_total',
      'counter',
      'Malformed frames that got the client disconnected',
      s.badFrames,
    );

    lines.push(
      '# HELP dogfight_tick_milliseconds Simulation step time, worst room (last 120 ticks)',
      '# TYPE dogfight_tick_milliseconds gauge',
    );
    const stats: [string, number][] = [
      ['avg', s.tick.avg],
      ['0.5', s.tick.p50],
      ['0.95', s.tick.p95],
      ['0.99', s.tick.p99],
      ['max', s.tick.max],
    ];
    for (const [stat, value] of stats) {
      lines.push(`dogfight_tick_milliseconds{stat="${stat}"} ${format(value)}`);
    }
    metric(
      'dogfight_tick_overruns',
      'gauge',
      'Ticks that took longer than the interval, worst room',
      s.overruns,
    );

    metric(
      'dogfight_event_loop_delay_mean_milliseconds',
      'gauge',
      'Event loop delay, mean',
      s.loopDelayMeanMs,
    );
    metric(
      'dogfight_event_loop_delay_p99_milliseconds',
      'gauge',
      'Event loop delay, p99',
      s.loopDelayP99Ms,
    );
    metric(
      'dogfight_event_loop_delay_max_milliseconds',
      'gauge',
      'Event loop delay, max',
      s.loopDelayMaxMs,
    );
    metric(
      'dogfight_event_loop_utilization',
      'gauge',
      'Event loop busy fraction since the last scrape (0..1)',
      s.loopUtilization,
    );

    metric('dogfight_memory_rss_bytes', 'gauge', 'Resident set size', s.rssBytes);
    metric('dogfight_memory_heap_used_bytes', 'gauge', 'V8 heap used', s.heapUsedBytes);
    metric('dogfight_memory_heap_total_bytes', 'gauge', 'V8 heap total', s.heapTotalBytes);
    metric(
      'dogfight_memory_external_bytes',
      'gauge',
      'Memory held outside the V8 heap (buffers)',
      s.externalBytes,
    );
    metric('dogfight_uptime_seconds', 'gauge', 'Process uptime', s.uptimeSeconds);
    metric(
      'dogfight_process_cpu_seconds_total',
      'counter',
      'CPU time used by the process (user + system)',
      s.cpuSeconds,
    );
    return lines.join('\n') + '\n';
  }
}

function format(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}
