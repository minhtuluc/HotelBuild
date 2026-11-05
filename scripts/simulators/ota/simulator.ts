/**
 * Bộ mô phỏng OTA Pine Hill (HB-128; api.md §5.1, HB-120 AC8) — **công cụ kiểm thử**, không phải API
 * của đối tác và không được mount thành tuyến nào trong app. Nó chỉ gửi HTTP thật vào
 * `POST /api/v1/integrations/ota/{channel}/bookings` với đúng hợp đồng chữ ký HMAC của simulator.
 *
 * Hợp đồng phase A khoá (không đổi tên/signature):
 * `runSimulator({ baseUrl, clock, seed, scenario, accounts })` →
 * `{ sent, events: { eventId, provider, status, outcome }[] }`, `outcome ∈ accepted|duplicate|rejected|timeout`.
 *
 * Tất định theo `seed` + `clock`: chạy lại cùng cặp này sinh **đúng** bộ sự kiện cũ nên phía nhận chỉ
 * thấy bản trùng, không nhân thêm hàng inbox. Kịch bản lỗi do chính bộ mô phỏng tạo ra (sai chữ ký,
 * retry 5 lần, thứ tự modified/cancelled, timeout client) — không có nhánh nào cần server "giúp".
 */
import { createHmac } from 'node:crypto';

export type SimulatorScenario =
  | 'twenty-events'
  | 'bad-signature'
  | 'retry'
  | 'out-of-order'
  | 'timeout';

export type SimulatorOutcome = 'accepted' | 'duplicate' | 'rejected' | 'timeout';

export interface SimulatorAccount {
  readonly provider: string;
  readonly keyId: string;
  readonly accountId: string;
  readonly secret: string;
}

export interface SimulatorEventReport {
  readonly eventId: string;
  readonly provider: string;
  readonly status: number;
  readonly outcome: SimulatorOutcome;
}

export interface SimulatorReport {
  readonly sent: number;
  readonly events: readonly SimulatorEventReport[];
}

export interface SimulatorOptions {
  readonly baseUrl: string;
  readonly clock: Date;
  readonly seed: number;
  readonly scenario: SimulatorScenario;
  readonly accounts: readonly SimulatorAccount[];
}

type Provider = 'booking' | 'agoda' | 'airbnb';
type EventType = 'booking.created' | 'booking.modified' | 'booking.cancelled';

const PROVIDERS: readonly Provider[] = ['booking', 'agoda', 'airbnb'];
const EVENT_TYPES: readonly EventType[] = [
  'booking.created',
  'booking.modified',
  'booking.cancelled',
];

/** Sàn PRNG tất định (mulberry32): cùng seed ⇒ cùng dãy số, không phụ thuộc `Math.random`. */
function randomOf(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function accountOf(accounts: readonly SimulatorAccount[], provider: Provider): SimulatorAccount {
  const account = accounts.find((candidate) => candidate.provider === provider);
  if (account === undefined) throw new Error(`Simulator has no account for provider ${provider}`);
  return account;
}

function signatureOf(secret: string, timestamp: number, raw: string): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

interface EventDraft {
  readonly index: number;
  readonly provider: Provider;
  readonly account: SimulatorAccount;
  readonly eventId: string;
  readonly eventType: EventType;
  readonly bookingCode: string;
  readonly updatedAt: Date;
  readonly amount: number;
  readonly phoneDigits: number;
}

/** Thân sự kiện đúng `otaWebhookEventSchema`; thứ tự khoá cố định để raw bytes tất định. */
function rawOf(draft: EventDraft): string {
  return JSON.stringify({
    eventType: draft.eventType,
    providerAccountId: draft.account.accountId,
    providerBookingCode: draft.bookingCode,
    providerUpdatedAt: draft.updatedAt.toISOString(),
    propertyCode: 'H029-A',
    roomTypeCode: 'STD',
    checkIn: '2026-12-10',
    checkOut: '2026-12-12',
    adults: 2,
    children: 0,
    roomCount: 1,
    guest: {
      fullName: `Simulator Guest ${draft.index}`,
      phone: `+8490000${String(draft.phoneDigits).padStart(4, '0')}`,
    },
    amount: draft.amount,
    currency: 'VND',
    paymentCollected: draft.index % 2 === 0,
    note: `simulator seed ${draft.index}`,
  });
}

interface Delivery {
  readonly baseUrl: string;
  readonly provider: Provider;
  readonly eventId: string;
  readonly keyId: string;
  readonly signature: string;
  readonly raw: string;
  /** `true` = client bỏ dở request (kịch bản timeout); server có thể đã ghi hoặc chưa. */
  readonly abort?: boolean;
}

/** `status = 0` nghĩa là client không nhận được phản hồi (abort/network) — kết cục bất định. */
async function deliver(delivery: Delivery): Promise<number> {
  const controller = new AbortController();
  if (delivery.abort === true) {
    controller.abort();
  }
  try {
    const response = await fetch(
      `${delivery.baseUrl}/api/v1/integrations/ota/${delivery.provider}/bookings`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pinehill-signature': delivery.signature,
          'x-pinehill-key-id': delivery.keyId,
          'x-channel-event-id': delivery.eventId,
        },
        body: delivery.raw,
        signal: controller.signal,
      },
    );
    // Đọc hết thân để giải phóng kết nối; nội dung ACK không cần cho báo cáo.
    await response.text();
    return response.status;
  } catch {
    return 0;
  }
}

function outcomeOf(status: number): SimulatorOutcome {
  if (status === 202) return 'accepted';
  if (status === 200) return 'duplicate';
  if (status === 0) return 'timeout';
  return 'rejected';
}

/** Gửi một lượt và ghi lại kết cục cho báo cáo. */
async function attempt(
  report: SimulatorEventReport[],
  delivery: Delivery,
): Promise<SimulatorEventReport> {
  const status = await deliver(delivery);
  const event: SimulatorEventReport = {
    eventId: delivery.eventId,
    provider: delivery.provider,
    status,
    outcome: outcomeOf(status),
  };
  report.push(event);
  return event;
}

interface ScenarioContext {
  readonly options: SimulatorOptions;
  readonly timestamp: number;
  readonly report: SimulatorEventReport[];
}

function draftOf(context: ScenarioContext, index: number, eventType?: EventType): EventDraft {
  const provider = PROVIDERS[index % PROVIDERS.length] ?? 'booking';
  const account = accountOf(context.options.accounts, provider);
  const random = randomOf(context.options.seed + index);
  return {
    index,
    provider,
    account,
    eventId: `hb128-sim-${context.options.seed}-${index}`,
    eventType: eventType ?? EVENT_TYPES[index % EVENT_TYPES.length] ?? 'booking.created',
    bookingCode: `SIM-${context.options.seed}-${index}`,
    updatedAt: new Date(context.options.clock.getTime() + index * 60_000),
    amount: 1_000_000 + Math.floor(random() * 1_000) * 1_000,
    phoneDigits: index,
  };
}

function deliveryOf(context: ScenarioContext, draft: EventDraft, secret: string): Delivery {
  const raw = rawOf(draft);
  return {
    baseUrl: context.options.baseUrl,
    provider: draft.provider,
    eventId: draft.eventId,
    keyId: draft.account.keyId,
    signature: signatureOf(secret, context.timestamp, raw),
    raw,
  };
}

/** 20 sự kiện đa kênh: mỗi sự kiện một booking/event ID, cùng clock nên chạy lại là bản trùng. */
async function twentyEvents(context: ScenarioContext): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const draft = draftOf(context, index);
    await attempt(context.report, deliveryOf(context, draft, draft.account.secret));
  }
}

/** Chữ ký do chính bộ mô phỏng tạo sai: mọi lần `401`, không hàng inbox nào. */
async function badSignature(context: ScenarioContext): Promise<void> {
  for (let index = 0; index < PROVIDERS.length; index += 1) {
    const draft = draftOf(context, index);
    await attempt(context.report, deliveryOf(context, draft, `${draft.account.secret}:forged`));
  }
}

/** Cùng một sự kiện 5 lượt: một `202`, bốn `200` — retry không nhân inbox. */
async function retry(context: ScenarioContext): Promise<void> {
  const draft = draftOf(context, 0, 'booking.created');
  const delivery = deliveryOf(context, draft, draft.account.secret);
  for (let attemptIndex = 0; attemptIndex < 5; attemptIndex += 1)
    await attempt(context.report, delivery);
}

/** Ba sự kiện cùng booking nhưng tới sai thứ tự thời gian của provider. */
async function outOfOrder(context: ScenarioContext): Promise<void> {
  const order: readonly EventType[] = ['booking.cancelled', 'booking.created', 'booking.modified'];
  for (const [index, eventType] of order.entries()) {
    const draft: EventDraft = {
      ...draftOf(context, 0, eventType),
      eventId: `hb128-sim-${context.options.seed}-ooo-${index}`,
      updatedAt: new Date(context.options.clock.getTime() - index * 60_000),
    };
    await attempt(context.report, deliveryOf(context, draft, draft.account.secret));
  }
}

/** Timeout client ở lượt đầu, rồi phát lại cùng event ID: tối đa một hàng inbox. */
async function timeout(context: ScenarioContext): Promise<void> {
  const draft = draftOf(context, 0, 'booking.created');
  const delivery = deliveryOf(context, draft, draft.account.secret);
  await attempt(context.report, { ...delivery, abort: true });
  await attempt(context.report, delivery);
  await attempt(context.report, delivery);
}

const SCENARIOS: Readonly<
  Record<SimulatorScenario, (context: ScenarioContext) => Promise<void>>
> = {
  'twenty-events': twentyEvents,
  'bad-signature': badSignature,
  retry,
  'out-of-order': outOfOrder,
  timeout,
};

export async function runSimulator(options: SimulatorOptions): Promise<SimulatorReport> {
  if (!Number.isInteger(options.seed)) throw new Error('Simulator seed must be an integer');
  const report: SimulatorEventReport[] = [];
  const scenario = SCENARIOS[options.scenario];
  if (scenario === undefined) throw new Error(`Unknown simulator scenario: ${String(options.scenario)}`);
  await scenario({
    options,
    timestamp: Math.floor(options.clock.getTime() / 1000),
    report,
  });
  return { sent: report.length, events: report };
}
