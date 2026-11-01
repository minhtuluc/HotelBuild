/**
 * HB-128 A — khoá hợp đồng của **bộ mô phỏng OTA** và chất lượng ACK (api.md §5.1, HB-120 AC8).
 *
 * Bộ mô phỏng là **công cụ kiểm thử**, không phải API của đối tác: nó nằm ngoài `apps/api` tại
 * `scripts/simulators/ota/simulator.ts` và chỉ gửi HTTP vào tuyến tiếp nhận thật. Hợp đồng phase A
 * (phase B phải tạo đúng tên/signature này):
 *
 * - `export function runSimulator(options): Promise<SimulatorReport>`
 * - `options = { baseUrl, clock: Date, seed: number, scenario, accounts }`, trong đó `accounts` là
 *   `{ provider, keyId, accountId, secret }[]` (cùng bộ cấu hình `chan.ota.accounts` của fixture).
 * - `scenario ∈ { 'twenty-events', 'bad-signature', 'retry', 'out-of-order', 'timeout' }`.
 * - `report = { sent: number, events: { eventId, provider, status, outcome }[] }` với
 *   `outcome ∈ { 'accepted', 'duplicate', 'rejected', 'timeout' }`.
 *
 * Ca `twenty-events-and-replay` (AC8): clock/kịch bản/seed tường minh, 20 sự kiện đa kênh trong ≤5 phút
 * vào 20 hàng inbox bền, payload đã chuẩn hoá; chạy lại **cùng seed + clock** chỉ sinh bản trùng, không
 * nhân inbox. Cùng ca kiểm các biến thể lỗi: chữ ký sai, retry 5 lần, modified/cancelled sai thứ tự,
 * timeout. Việc kiểm booking/case sau khi nối HB-129 thuộc HB-194 — không phụ thuộc ngược ở đây.
 *
 * Ca `ack-latency-and-safe-logs` (AC9): p95 HTTP ingestion ≤300 ms trên fixture (môi trường in ra
 * stdout làm bằng chứng) và log chỉ có correlation/event ID, không raw payload/SĐT/bí mật HMAC.
 *
 * File này là oracle của phase A: nó đỏ vì simulator/route thiếu, không vì fixture. Không sửa khi làm B.
 */
import { expect, test } from 'vitest';
import {
  accountOf,
  allAccounts,
  appUrl,
  CHANNEL_CODE,
  clock,
  deliver,
  draft,
  eventId,
  http,
  inboxAll,
  inboxOf,
  isObject,
  isProvider,
  loggedText,
  PROVIDERS,
  rows,
  storedPayload,
} from './fixture.js';

const SIMULATOR_URL = new URL('../../../../scripts/simulators/ota/simulator.ts', import.meta.url)
  .href;

interface SimulatorAccount {
  readonly provider: string;
  readonly keyId: string;
  readonly accountId: string;
  readonly secret: string;
}

type SimulatorScenario = 'twenty-events' | 'bad-signature' | 'retry' | 'out-of-order' | 'timeout';
type SimulatorOutcome = 'accepted' | 'duplicate' | 'rejected' | 'timeout';

interface SimulatorEventReport {
  readonly eventId: string;
  readonly provider: string;
  readonly status: number;
  readonly outcome: SimulatorOutcome;
}

interface SimulatorReport {
  readonly sent: number;
  readonly events: readonly SimulatorEventReport[];
}

interface SimulatorOptions {
  readonly baseUrl: string;
  readonly clock: Date;
  readonly seed: number;
  readonly scenario: SimulatorScenario;
  readonly accounts: readonly SimulatorAccount[];
}

type RunSimulator = (options: SimulatorOptions) => Promise<SimulatorReport>;

const isSimulatorModule = (value: unknown): value is { readonly runSimulator: RunSimulator } =>
  isObject(value) && 'runSimulator' in value && typeof value.runSimulator === 'function';

async function simulator(): Promise<RunSimulator> {
  // Import động: phase A không được import module chưa tồn tại (typecheck phải sạch trước khi B tạo nó).
  const loaded: unknown = await import(SIMULATOR_URL);
  if (!isSimulatorModule(loaded)) {
    throw new Error(
      `HB-128 simulator phải export runSimulator(options) từ scripts/simulators/ota/simulator.ts (${SIMULATOR_URL})`,
    );
  }
  return loaded.runSimulator;
}

test('twenty-events-and-replay', async () => {
  const runSimulator = await simulator();
  const baseUrl = await appUrl();
  const seededClock = clock.now();

  const startedAt = Date.now();
  const report = await runSimulator({
    baseUrl,
    clock: seededClock,
    seed: 128,
    scenario: 'twenty-events',
    accounts: allAccounts(),
  });
  expect(Date.now() - startedAt).toBeLessThanOrEqual(5 * 60 * 1000);
  expect(report.sent).toBe(20);
  expect(report.events).toHaveLength(20);
  expect(report.events.filter((event) => event.outcome === 'accepted')).toHaveLength(20);

  const stored = await inboxAll();
  expect(stored).toHaveLength(20);
  const perProvider = new Map<string, number>(PROVIDERS.map((provider) => [provider, 0]));
  for (const row of stored) {
    const provider = row.provider;
    expect(isProvider(provider)).toBe(true);
    if (!isProvider(provider)) continue;
    perProvider.set(provider, (perProvider.get(provider) ?? 0) + 1);
    // Payload đã chuẩn hoá: ChannelCode theo kênh và không lộ bí mật HMAC.
    expect(storedPayload(row).channelCode).toBe(CHANNEL_CODE[provider]);
    expect(JSON.stringify(row.payload_json).includes(accountOf(provider).secret)).toBe(false);
  }
  expect(PROVIDERS.every((provider) => (perProvider.get(provider) ?? 0) > 0)).toBe(true);

  // Cùng seed + clock ⇒ cùng sự kiện; phát lại không nhân inbox.
  const replay = await runSimulator({
    baseUrl,
    clock: seededClock,
    seed: 128,
    scenario: 'twenty-events',
    accounts: allAccounts(),
  });
  expect(replay.events.filter((event) => event.outcome === 'duplicate')).toHaveLength(20);
  expect(await inboxAll()).toHaveLength(20);

  // Chữ ký sai do chính bộ mô phỏng tạo ra: mọi lần 401, không hàng inbox nào.
  await rows('DELETE FROM webhook_inbox');
  const forged = await runSimulator({
    baseUrl,
    clock: clock.now(),
    seed: 129,
    scenario: 'bad-signature',
    accounts: allAccounts(),
  });
  expect(forged.events.length).toBeGreaterThan(0);
  expect(forged.events.every((event) => event.status === 401 && event.outcome === 'rejected')).toBe(
    true,
  );
  expect(await inboxAll()).toHaveLength(0);

  // Retry 5 lần cùng một sự kiện: một hàng inbox, bốn ACK trùng.
  const retry = await runSimulator({
    baseUrl,
    clock: clock.now(),
    seed: 130,
    scenario: 'retry',
    accounts: allAccounts(),
  });
  expect(retry.sent).toBe(5);
  expect(retry.events.filter((event) => event.status === 202)).toHaveLength(1);
  expect(retry.events.filter((event) => event.status === 200)).toHaveLength(4);
  expect(new Set(retry.events.map((event) => event.eventId)).size).toBe(1);
  expect(await inboxAll()).toHaveLength(1);

  // modified/cancelled sai thứ tự: vẫn được nhận bền từng sự kiện, không mất bản tin.
  await rows('DELETE FROM webhook_inbox');
  const unordered = await runSimulator({
    baseUrl,
    clock: clock.now(),
    seed: 131,
    scenario: 'out-of-order',
    accounts: allAccounts(),
  });
  expect(unordered.events.every((event) => event.status === 202 || event.status === 200)).toBe(
    true,
  );
  const received = await inboxAll();
  expect(received).toHaveLength(unordered.events.length);
  const types = received.map((row) => storedPayload(row).eventType);
  expect(types).toContain('booking.created');
  expect(types).toContain('booking.cancelled');

  // Timeout của client: kết cục bất định nhưng KHÔNG được sinh hàng thứ hai khi phát lại.
  await rows('DELETE FROM webhook_inbox');
  const timed = await runSimulator({
    baseUrl,
    clock: clock.now(),
    seed: 132,
    scenario: 'timeout',
    accounts: allAccounts(),
  });
  expect(timed.events.some((event) => event.outcome === 'timeout')).toBe(true);
  expect(new Set(timed.events.map((event) => event.eventId)).size).toBe(1);
  const lastAttempt = timed.events[timed.events.length - 1]!;
  expect(['accepted', 'duplicate']).toContain(lastAttempt.outcome);
  expect((await inboxOf(lastAttempt.eventId)).length).toBeLessThanOrEqual(1);

  // Bộ mô phỏng KHÔNG được mount thành tuyến của đối tác trong app.
  expect(SIMULATOR_URL).toContain('/scripts/simulators/ota/');
  const notAnApi = await http()
    .post('/api/v1/integrations/ota/simulator/bookings')
    .set('Content-Type', 'application/json')
    .send('{}');
  expect(notAnApi.status).toBe(404);
});

test('ack-latency-and-safe-logs', async () => {
  const phone = '+84900001280';
  const logged = draft({
    bookingCode: 'HB128-LOG-0001',
    guestName: 'HB128 Log Guest',
    guestPhone: phone,
  });
  const logId = eventId('log');
  const accepted = await deliver({ provider: 'booking', eventId: logId, raw: logged.raw });
  expect(accepted.status).toBe(202);

  const samples: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const payload = draft({ bookingCode: `HB128-LAT-${String(index).padStart(4, '0')}` });
    const startedAt = process.hrtime.bigint();
    const response = await deliver({
      provider: 'booking',
      eventId: eventId(`latency-${index}`),
      raw: payload.raw,
    });
    samples.push(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
    expect(response.status).toBe(202);
  }
  samples.sort((left, right) => left - right);
  // p95 theo mẫu hữu hạn: phần tử ⌈0,95·n⌉.
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  const databasePort = new URL(process.env.DATABASE_URL ?? 'postgresql://127.0.0.1:5432').port;
  process.stdout.write(
    `[HB-128] ACK ingestion p95=${p95.toFixed(1)}ms n=${samples.length} postgresPort=${databasePort} redisDb=11 node=${process.version}\n`,
  );
  expect(p95).toBeLessThanOrEqual(300);

  // Log của lần nhận chỉ được có correlation/event ID; không raw payload, SĐT hay bí mật HMAC.
  const text = loggedText();
  expect(text.length).toBeGreaterThan(0);
  expect(text).toContain(logId);
  for (const marker of [
    phone,
    phone.slice(1),
    accountOf('booking').secret,
    'HB128 Log Guest',
    'paymentCollected',
  ]) {
    expect(text.includes(marker), 'Raw payload/PII/HMAC secret must not enter logs').toBe(false);
  }
});
