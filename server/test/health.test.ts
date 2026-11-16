import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connect, makeRoom, setup } from './helpers.ts';

const HealthSchema = z.object({
  status: z.literal('ok'),
  sha: z.string(),
  version: z.string(),
  uptime: z.number(),
  rooms: z.number(),
});
const ReadySchema = z.object({
  ready: z.boolean(),
  reason: z.string().optional(),
  players: z.number(),
});

describe('/health, /ready, /metrics', () => {
  it('/health віддає sha і версію збірки, поки процес живий', async () => {
    const { app, base } = await setup({ gitSha: 'abc1234', appVersion: 'v1.2.3' });
    const body = HealthSchema.parse(await (await fetch(`${base}/health`)).json());
    expect(body.sha).toBe('abc1234');
    expect(body.version).toBe('v1.2.3');
    await app.shutdown();
  });

  it('/ready це 200, поки є місце для гравців', async () => {
    const { app, base } = await setup();
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(200);
    expect(ReadySchema.parse(await res.json()).ready).toBe(true);
    await app.shutdown();
  });

  it('/ready стає 503 з причиною full, коли гравців стільки, скільки дозволено', async () => {
    const { app, port, base } = await setup({ maxTotalPlayers: 1 });
    const room = await makeRoom(base);
    const a = connect(port);
    await a.opened;
    a.send({ type: 'join', room: room.id, name: 'Ann' });
    await a.next('welcome');

    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(503);
    expect(ReadySchema.parse(await res.json())).toMatchObject({ ready: false, reason: 'full' });

    // /health при цьому живий: процес працює, просто нових гравців не бере
    expect((await fetch(`${base}/health`)).status).toBe(200);

    // і другий гравець справді не заходить
    const b = connect(port);
    await b.opened;
    b.send({ type: 'join', room: room.id, name: 'Bob' });
    expect(await b.closed).toBe(4002);

    a.socket.close();
    await app.shutdown();
  });

  it('/metrics віддає текст Prometheus з потрібними показниками', async () => {
    const { app, port, base } = await setup();
    const room = await makeRoom(base);
    const a = connect(port);
    await a.opened;
    a.send({ type: 'join', room: room.id, name: 'Ann' });
    await a.next('welcome');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const res = await fetch(`${base}/metrics`);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    for (const name of [
      'dogfight_players 1',
      'dogfight_rooms 1',
      'dogfight_messages_received_total',
      'dogfight_messages_sent_total',
      'dogfight_bytes_sent_total',
      'dogfight_messages_per_second',
      'dogfight_bytes_sent_per_second',
      'dogfight_tick_milliseconds{stat="0.99"}',
      'dogfight_event_loop_delay_p99_milliseconds',
      'dogfight_event_loop_utilization',
      'dogfight_memory_rss_bytes',
      'dogfight_memory_heap_used_bytes',
    ]) {
      expect(text, name).toContain(name);
    }
    // лічильники справді ростуть: знімки пішли клієнту
    const sent = Number(/dogfight_messages_sent_total (\d+)/.exec(text)?.[1] ?? 0);
    expect(sent).toBeGreaterThan(3);

    a.socket.close();
    await app.shutdown();
  });

  it('кожен рядок метрик має вигляд "назва{мітки} число" або коментар', async () => {
    const { app, base } = await setup();
    const text = await (await fetch(`${base}/metrics`)).text();
    for (const line of text.trim().split('\n')) {
      expect(line).toMatch(/^(# (HELP|TYPE) \S+ .+|[a-z0-9_]+(\{[^}]*\})? -?\d+(\.\d+)?)$/);
    }
    await app.shutdown();
  });
});
