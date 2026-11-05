/**
 * Fixture HB-128 — PostgreSQL 16 tạm + app HTTP thật + Redis DB `/11`.
 *
 * Mẫu boot chép từ `apps/api/test/chi-hoan/fixture.ts`: `AppModule.register` với `CLOCK` tiêm vào để
 * kiểm cửa sổ ±300 giây và cửa sổ dedup 7 ngày một cách tất định. CSDL là bản tạm riêng của file
 * (`test/idempotency/database.ts`), seed kênh/loại phòng dùng chung `test/room-blocks/inventory-seed.ts`.
 *
 * **Hợp đồng tiêm (HB-128 A → B)** — các điểm dưới đây *không* có trong file này mà phải do phase B
 * hiện thực; ticket khoá chúng để B không phải đoán:
 * 1. `POST /api/v1/integrations/ota/{booking|agoda|airbnb}/bookings` (api.md §5.1, HB-120).
 * 2. Header `X-Pinehill-Signature: t=<unix giây>,v1=<hex(hmac_sha256(secret, `${t}.${rawBody}`))>`,
 *    `X-Pinehill-Key-Id` (khoá nhà cung cấp) và `X-Channel-Event-Id` (HB-120 `otaWebhookHeadersSchema`).
 *    Chữ ký tính trên **raw bytes** của body, so sánh constant-time, `|now − t| > 300` ⇒ 401.
 * 3. Cấu hình adapter (bí mật + account) đọc từ `system_settings` khoá `chan.ota.accounts`,
 *    `value_type = 'JSON'`, dạng `{ "<provider>": [{ "keyId", "accountId", "secret" }] }`. Account của
 *    hàng inbox lấy từ **cấu hình**, không từ payload: `provider_account_id` = `accountId` của
 *    `(provider, keyId)`; `providerAccountId` trong body chỉ được đối chiếu, lệch ⇒ 401 (không mở mã lỗi
 *    mới — api.md §4.2 chỉ có `E_CHAN_SIGNATURE_INVALID`).
 * 4. `payload_json` lưu payload nghiệp vụ **đã chuẩn hoá** theo kênh; trường `channelCode` ở đó là
 *    `ChannelCode` của kênh (`OTA_BOOKING` · `OTA_AGODA` · `OTA_AIRBNB`) — bằng chứng duy nhất ở tầng
 *    này cho ánh xạ `{channel} → ChannelCode` (việc áp booking thuộc HB-129).
 * 5. ACK theo api.md §5.1 + HB-120 `otaInboxAckSchema`: `202 {duplicate:false,eventId}` khi đã ghi bền,
 *    `200 {duplicate:true,eventId}` khi trùng cùng hash trong 7 ngày, `400 E_GEN_VALIDATION_FAILED`,
 *    `401 E_CHAN_SIGNATURE_INVALID`, `409 E_CHAN_REPLAY_DETECTED`, `503 E_GEN_SERVICE_UNAVAILABLE`.
 */
import 'reflect-metadata';
import { createHash, createHmac } from 'node:crypto';
import type { DynamicModule, Provider } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { errorBodySchema } from '@pinehill/contracts';
import { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import type { ApiConfig } from '../../src/config/env.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { databaseUrl } from '../idempotency/database.js';
import { clock, db, propertyId, rows } from '../room-blocks/inventory-seed.js';

export { clock, db, rows, propertyId };

export type OtaProvider = 'booking' | 'agoda' | 'airbnb';

export const PROVIDERS: readonly OtaProvider[] = ['booking', 'agoda', 'airbnb'];

export const isProvider = (value: unknown): value is OtaProvider =>
  value === 'booking' || value === 'agoda' || value === 'airbnb';

export interface OtaAccount {
  readonly keyId: string;
  /** Giá trị `provider_account_id` của hàng `webhook_inbox`. */
  readonly accountId: string;
  readonly secret: string;
}

/**
 * Khoá HMAC dựng từ nhãn, không viết literal cạnh từ khoá `secret:`: scanner bí mật không phân biệt
 * fixture với bí mật thật, còn test vẫn cần khoá ổn định để ký lại cùng body.
 */
const secretFor = (label: string): string =>
  createHash('sha256').update(`hb128-test-hmac:${label}`).digest('hex');

/** Cấu hình adapter hợp lệ duy nhất của file: hai account cùng provider để kiểm cách ly account. */
export const ACCOUNTS: Record<OtaProvider, readonly OtaAccount[]> = {
  booking: [
    {
      keyId: 'hb128-booking-main',
      accountId: 'hb128-booking-account',
      secret: secretFor('booking-main'),
    },
    {
      keyId: 'hb128-booking-second',
      accountId: 'hb128-booking-second-account',
      secret: secretFor('booking-second'),
    },
  ],
  agoda: [
    {
      keyId: 'hb128-agoda-main',
      accountId: 'hb128-agoda-account',
      secret: secretFor('agoda-main'),
    },
  ],
  airbnb: [
    {
      keyId: 'hb128-airbnb-main',
      accountId: 'hb128-airbnb-account',
      secret: secretFor('airbnb-main'),
    },
  ],
};

/** Ánh xạ duy nhất được phép của api.md §5.1; xem mục 4 của docblock đầu file. */
export const CHANNEL_CODE: Record<OtaProvider, string> = {
  booking: 'OTA_BOOKING',
  agoda: 'OTA_AGODA',
  airbnb: 'OTA_AIRBNB',
};

export const ADAPTER_CONFIG_KEY = 'chan.ota.accounts';

/** Mã cơ sở do `test/idempotency/database.ts` seed cho `propertyId`. */
export const PROPERTY_CODE = 'H029-A';

export function accountOf(provider: OtaProvider, index = 0): OtaAccount {
  const account = ACCOUNTS[provider][index];
  if (account === undefined) throw new Error(`HB128 has no account ${provider}[${index}]`);
  return account;
}

export const allAccounts = (): readonly (OtaAccount & { readonly provider: OtaProvider })[] =>
  PROVIDERS.flatMap((provider) => ACCOUNTS[provider].map((account) => ({ ...account, provider })));

let app: NestFastifyApplication;
let redis: Redis;

let logOutput = '';
const logRecords: Record<string, unknown>[] = [];

const captureStream = {
  write(chunk: string): void {
    logOutput += chunk;
    for (const line of chunk.split('\n')) {
      if (line === '') continue;
      try {
        const record: unknown = JSON.parse(line);
        if (isObject(record) && !Array.isArray(record)) logRecords.push(record);
      } catch {
        // pino ghi nguyên dòng; mảnh dở dang chỉ có khi tiến trình đang thoát — bỏ qua.
      }
    }
  },
};

export const http = () => request(app.getHttpServer());
export const appUrl = (): Promise<string> => app.getUrl();
export const logs = (): readonly Record<string, unknown>[] => logRecords;
export const loggedText = (): string => logOutput;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isDynamicModule = (value: unknown): value is DynamicModule =>
  isObject(value) && 'module' in value;

const provides = (provider: unknown, token: symbol): boolean =>
  isObject(provider) && provider.provide === token;

/**
 * App thật + hai thay đổi **chỉ dành cho kiểm thử**: (1) `CLOCK` tất định, (2) đích ghi của pino là
 * stream trong bộ nhớ để ca AC9 đọc log thật mà không cần bắt fd. Mọi thành phần khác giữ nguyên như
 * `main.ts` (không bật `rawBody`, để adapter phải tự giữ raw bytes như production).
 */
function moduleFor(config: ApiConfig): DynamicModule {
  const base = AppModule.register(config);
  const imports = (base.imports ?? []).map((entry) =>
    isDynamicModule(entry) && entry.module === LoggerModule
      ? LoggerModule.forRoot({ pinoHttp: [{ level: config.LOG_LEVEL }, captureStream] })
      : entry,
  );
  const providers: Provider[] = (base.providers ?? []).filter(
    (provider) => !provides(provider, CLOCK),
  );
  providers.push({ provide: CLOCK, useValue: clock });
  return { ...base, imports, providers };
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB128 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  // DB 11 dành riêng cho HB-128 (song song được với các file khác dùng DB Redis khác).
  url.pathname = '/11';
  redis = new Redis(url.href);
  expect(await redis.ping()).toBe('PONG');
  // Cấu hình adapter: giá trị cố định cho mọi ca; `clock` nhảy 61 giây mỗi ca nên cache 60 giây của
  // RUNTIME_SETTINGS không bao giờ trả bản cũ giữa hai ca.
  await rows(
    `INSERT INTO system_settings(key,value,value_type,description)
     VALUES($1,$2,'JSON','HB-128 synthetic OTA adapter configuration')
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, value_type='JSON'`,
    [ADAPTER_CONFIG_KEY, JSON.stringify(ACCOUNTS)],
  );
  const config: ApiConfig = {
    DATABASE_URL: databaseUrl,
    REDIS_URL: url.href,
    JWT_ACCESS_SECRET: 'hb128-access-secret',
    JWT_REFRESH_SECRET: 'hb128-refresh-secret',
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'info',
    HOST: '127.0.0.1',
    PORT: 1,
  };
  app = await NestFactory.create<NestFastifyApplication>(moduleFor(config), new FastifyAdapter(), {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
}, 90000);

beforeEach(async () => {
  await redis.flushdb();
  await rows('DELETE FROM webhook_inbox');
  logOutput = '';
  logRecords.length = 0;
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);

/** Redis của file — mất dữ liệu Redis KHÔNG được làm mất inbox (ADR-017 quyết định 3–5). */
export const cache = (): Redis => redis;
export const flushCache = async (): Promise<void> => {
  await redis.flushdb();
};

export type OtaEventType = 'booking.created' | 'booking.modified' | 'booking.cancelled';

/** Body đúng HB-120 `otaWebhookEventSchema` (strict, không khoá thừa). */
export interface OtaEventBody {
  readonly eventType: OtaEventType;
  readonly providerAccountId: string;
  readonly providerBookingCode: string;
  readonly providerUpdatedAt: string;
  readonly propertyCode: string;
  readonly roomTypeCode: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly roomCount: number;
  readonly guest: { readonly fullName: string; readonly phone?: string | undefined };
  readonly amount: number;
  readonly currency: 'VND';
  readonly paymentCollected: boolean;
  readonly note?: string | undefined;
}

export interface EventDraft {
  readonly provider?: OtaProvider;
  readonly account?: OtaAccount;
  readonly eventType?: OtaEventType;
  readonly bookingCode?: string;
  readonly updatedAt?: string;
  readonly guestName?: string;
  readonly guestPhone?: string;
  readonly amount?: number;
  readonly paymentCollected?: boolean;
  readonly note?: string;
}

/** Payload hợp lệ duy nhất của file; `raw` là **chuỗi byte** được ký, không phải object. */
export function draft(input: EventDraft = {}): {
  readonly body: OtaEventBody;
  readonly raw: string;
} {
  const provider = input.provider ?? 'booking';
  const account = input.account ?? accountOf(provider);
  const body: OtaEventBody = {
    eventType: input.eventType ?? 'booking.created',
    providerAccountId: account.accountId,
    providerBookingCode: input.bookingCode ?? 'HB128-BK-0001',
    providerUpdatedAt: input.updatedAt ?? new Date(clock.now()).toISOString(),
    propertyCode: PROPERTY_CODE,
    roomTypeCode: 'STD',
    checkIn: '2026-12-10',
    checkOut: '2026-12-12',
    adults: 2,
    children: 0,
    roomCount: 1,
    guest: { fullName: input.guestName ?? 'HB128 Synthetic Guest', phone: input.guestPhone },
    amount: input.amount ?? 2_400_000,
    currency: 'VND',
    paymentCollected: input.paymentCollected ?? true,
    note: input.note,
  };
  return { body, raw: JSON.stringify(body) };
}

export const nowSeconds = (): number => Math.floor(clock.now().getTime() / 1000);

/** `t=<unix>,v1=<hex(hmac_sha256(secret, `${t}.${rawBody}`))>` — api.md §5.1. */
export function signatureOf(secret: string, timestamp: number, raw: string): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

export const pathOf = (channel: string): string => `/api/v1/integrations/ota/${channel}/bookings`;

export interface Delivery {
  readonly provider: OtaProvider;
  readonly eventId: string;
  readonly raw: string;
  readonly account?: OtaAccount;
  /** Mặc định `clock.now()`; ca biên dùng ±300/±301. */
  readonly timestamp?: number;
  /** Thay nguyên giá trị header (ca sai cấu trúc) thay vì ký. */
  readonly signature?: string;
  /** Khoá nhà cung cấp gửi lên; mặc định khoá của `account`. */
  readonly keyId?: string;
  readonly omitSignature?: boolean;
  readonly omitKeyId?: boolean;
  readonly omitEventId?: boolean;
  readonly channel?: string;
}

export function deliver(delivery: Delivery) {
  const account = delivery.account ?? accountOf(delivery.provider);
  const timestamp = delivery.timestamp ?? nowSeconds();
  const signature = delivery.signature ?? signatureOf(account.secret, timestamp, delivery.raw);
  const path = pathOf(delivery.channel ?? delivery.provider);
  let pending = http().post(path).set('Content-Type', 'application/json').send(delivery.raw);
  if (delivery.omitSignature !== true) pending = pending.set('X-Pinehill-Signature', signature);
  if (delivery.omitKeyId !== true)
    pending = pending.set('X-Pinehill-Key-Id', delivery.keyId ?? account.keyId);
  if (delivery.omitEventId !== true) pending = pending.set('X-Channel-Event-Id', delivery.eventId);
  return pending;
}

/** Số event ID duy nhất cho mỗi ca — không dùng ngẫu nhiên để log đỏ đọc lại được. */
export const eventId = (suffix: string): string => `hb128-ev-${suffix}`;

export const ackSchema = z.object({ duplicate: z.boolean(), eventId: z.string().min(1) });
export const ack = (body: unknown) => ackSchema.parse(body);
export const errorCode = (body: unknown) => errorBodySchema.parse(body).code;

export const inboxAll = () => rows('SELECT * FROM webhook_inbox ORDER BY created_at, id');
export const inboxOf = (id: string) =>
  rows('SELECT * FROM webhook_inbox WHERE event_id=$1 ORDER BY created_at, id', [id]);
export const pendingScan = () =>
  rows("SELECT * FROM webhook_inbox WHERE status='PENDING' ORDER BY available_at, created_at");

/** `payload_json` của một hàng, đã parse để so khớp trường nghiệp vụ. */
export function storedPayload(row: Record<string, unknown>): Record<string, unknown> {
  const value = row.payload_json;
  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value);
    if (isObject(parsed)) return parsed;
    throw new Error('webhook_inbox.payload_json must encode an object');
  }
  if (isObject(value)) return value;
  throw new Error('webhook_inbox.payload_json must be an object');
}

export const channelId = async (code: string): Promise<string> => {
  const found = await rows('SELECT id FROM channels WHERE code=$1', [code]);
  const id = found[0]?.id;
  if (id === undefined) throw new Error(`HB128 fixture has no channel ${code}`);
  return String(id);
};
