/**
 * Fixture HB-129 giai đoạn A — PostgreSQL16 tạm + app HTTP thật + Redis DB `/13`.
 *
 * Mẫu boot chép từ `apps/api/test/ota-inbox/fixture.ts` (HB-128): `AppModule.register` với `CLOCK`
 * tiêm, CSDL tạm của `test/idempotency/database.ts`, seed kênh/loại phòng dùng chung
 * `test/room-blocks/inventory-seed.ts`. KHÔNG import hay sửa fixture HB-128: intake đã khoá, còn file
 * này chỉ bổ sung dữ kiện F6 (ánh xạ kênh, hạn mức, loại phòng FAM 8 phòng) và cổng gọi use case áp
 * inbox (`./contract.ts`).
 *
 * Vì sao event đi qua webhook thật: AC1–AC11 nói về "inbox **đã xác minh**", nên hàng inbox phải do
 * `POST /integrations/ota/{channel}/bookings` ghi bền (HMAC + dedup của HB-128) — không tự chèn tay
 * để tránh kiểm một trạng thái mà production không tạo ra được.
 *
 * Phân vùng tài nguyên: Redis `/13` (ticket này), CSDL riêng mỗi file do `database.ts` sinh.
 */
import 'reflect-metadata';
import { createHash, createHmac } from 'node:crypto';
import type { DynamicModule, Provider } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { tokenPairSchema } from '@pinehill/contracts';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import type { ApiConfig } from '../../src/config/env.js';
import { AuditWriter } from '../../src/infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { RateQuoteService } from '../../src/modules/rate/quotes/service.js';
import { databaseUrl, password } from '../idempotency/database.js';
import {
  clock,
  db,
  dormTypeId,
  ids,
  propertyId,
  rows,
  secondUserId,
  typeId,
  userId,
} from '../room-blocks/inventory-seed.js';
import {
  loadApplier,
  otaApplyResultSchema,
  type OtaApplyResult,
  type OtaInboxApplier,
} from './contract.js';
import { GUEST_PHONE } from './assertions.js';

export { clock, db, dormTypeId, ids, propertyId, rows, secondUserId, typeId, userId };

/** Mã cơ sở do `test/idempotency/database.ts` seed cho `propertyId`. */
export const PROPERTY_CODE = 'H029-A';
/** Loại phòng dùng chung của seed: STD 2 phòng vật lý. */
export const STD_CODE = 'STD';
/** Loại phòng HB-129 tự thêm: 8 đơn vị, đủ chỗ cho ca "quota hết nhưng còn cung". */
export const FAM_CODE = 'FAM';
/** Loại phòng DOR của seed: một phòng 6 giường — đơn vị bán là **giường**. */
export const DORM_CODE = 'DOR';

/** Ngày của ca chính (Thứ Năm–Thứ Bảy, tránh phụ thuộc cuối tuần khi đối chiếu số tiền). */
export const stay = { checkIn: '2026-12-10', checkOut: '2026-12-12' } as const;

export interface OtaAccount {
  readonly keyId: string;
  readonly accountId: string;
  readonly secret: string;
}

export type OtaProvider = 'booking' | 'agoda' | 'airbnb';

/**
 * Hai account cùng provider `booking` để kiểm cách ly account ở khoá tự nhiên (AC4) và tombstone
 * theo `(channel, account, providerBookingCode)` (AC9). Bí mật dựng từ nhãn bằng SHA-256, không viết
 * literal cạnh `secret:` (scanner bí mật không phân biệt fixture với khoá thật).
 */
const secretFor = (label: string): string =>
  createHash('sha256').update(`hb129-test-hmac:${label}`).digest('hex');
export const ACCOUNTS: Readonly<Record<OtaProvider, readonly OtaAccount[]>> = {
  booking: [
    {
      keyId: 'hb129-booking-main',
      accountId: 'hb129-booking-account',
      secret: secretFor('booking-main'),
    },
    {
      keyId: 'hb129-booking-second',
      accountId: 'hb129-booking-second-account',
      secret: secretFor('booking-second'),
    },
  ],
  agoda: [
    {
      keyId: 'hb129-agoda-main',
      accountId: 'hb129-agoda-account',
      secret: secretFor('agoda-main'),
    },
  ],
  airbnb: [
    {
      keyId: 'hb129-airbnb-main',
      accountId: 'hb129-airbnb-account',
      secret: secretFor('airbnb-main'),
    },
  ],
};

/** Ánh xạ duy nhất của api.md §5.1 cho `{channel} → ChannelCode`. */
export const CHANNEL_CODE: Readonly<Record<OtaProvider, string>> = {
  booking: 'OTA_BOOKING',
  agoda: 'OTA_AGODA',
  airbnb: 'OTA_AIRBNB',
};

export const ADAPTER_CONFIG_KEY = 'chan.ota.accounts';

export function accountOf(provider: OtaProvider, index = 0): OtaAccount {
  const account = ACCOUNTS[provider][index];
  if (account === undefined) throw new Error(`HB129 has no account ${provider}[${index}]`);
  return account;
}

let app: NestFastifyApplication;
let redis: Redis;
let famTypeId = '';

export const http = () => request(app.getHttpServer());
export const cache = (): Redis => redis;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const provides = (provider: Provider, token: symbol): boolean =>
  typeof provider === 'object' &&
  provider !== null &&
  'provide' in provider &&
  provider.provide === token;

/**
 * App thật + thay đổi **duy nhất** dành cho kiểm thử: `CLOCK` tất định để so mốc `cancelledAt`,
 * `processed_at` và ranh giới T−24h. Mọi thành phần khác giữ nguyên `main.ts`.
 */
function moduleFor(config: ApiConfig): DynamicModule {
  const base = AppModule.register(config);
  const providers: Provider[] = (base.providers ?? []).filter(
    (provider) => !provides(provider, CLOCK),
  );
  providers.push({ provide: CLOCK, useValue: clock });
  return { ...base, providers };
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB129 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/13';
  redis = new Redis(url.href);
  expect(await redis.ping()).toBe('PONG');
  await rows(
    `INSERT INTO system_settings(key,value,value_type,description)
     VALUES($1,$2,'JSON','HB-129 synthetic OTA adapter configuration')
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, value_type='JSON'`,
    [ADAPTER_CONFIG_KEY, JSON.stringify(ACCOUNTS)],
  );
  await rows(
    "UPDATE channels SET multiplier=1, commission_pct=0, hold_minutes=0, overbook_allowed=false, status='ACTIVE' WHERE code LIKE 'OTA_%'",
  );
  await rows('UPDATE properties SET overbook_limit_pct=0');
  await rows("UPDATE cancellation_policies SET is_default=true WHERE code='H034'");
  const fam = await rows(
    `INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price)
     VALUES($1,'FAM','Family',4,120000,120000,240000) RETURNING id`,
    [propertyId],
  );
  const famId = fam[0]?.id;
  if (typeof famId !== 'string') throw new Error('HB129 cannot seed FAM room type');
  famTypeId = famId;
  for (let index = 1; index <= 8; index += 1) {
    await rows('INSERT INTO rooms(property_id,room_type_id,code,name) VALUES($1,$2,$3,$3)', [
      propertyId,
      famTypeId,
      `FA${index}`,
    ]);
  }
  const channel = (await rows("SELECT id FROM channels WHERE code='OTA_BOOKING'"))[0]?.id;
  if (typeof channel !== 'string') throw new Error('HB129 has no OTA_BOOKING channel');
  for (const [code, roomTypeId] of [
    [STD_CODE, typeId],
    [FAM_CODE, famTypeId],
    [DORM_CODE, dormTypeId],
  ] as const) {
    await rows(
      'INSERT INTO channel_mappings(channel_id,room_type_id,external_room_code) VALUES($1,$2,$3)',
      [channel, roomTypeId, code],
    );
  }
  const config: ApiConfig = {
    DATABASE_URL: databaseUrl,
    REDIS_URL: url.href,
    JWT_ACCESS_SECRET: 'hb129-access-secret',
    JWT_REFRESH_SECRET: 'hb129-refresh-secret',
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    PORT: 1,
  };
  app = await NestFactory.create<NestFastifyApplication>(moduleFor(config), new FastifyAdapter(), {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
}, 120000);

beforeEach(async () => {
  await redis.flushdb();
  await rows('DELETE FROM event_deliveries');
  await rows('DELETE FROM outbox_events');
  await rows('DELETE FROM webhook_inbox');
  await rows('DELETE FROM channel_cancel_tombstones');
  await rows('DELETE FROM channel_sync_watermarks');
  await rows('DELETE FROM channel_sales_closures');
  await rows('DELETE FROM idempotency_keys');
  await rows("UPDATE channels SET status='ACTIVE', overbook_allowed=false");
  await rows('UPDATE properties SET overbook_limit_pct=0');
  clock.value = Date.UTC(2026, 11, 1);
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
}, 30000);

export const famRoomTypeId = (): string => famTypeId;

export async function channelIdOf(code: string): Promise<string> {
  const id = (await rows('SELECT id FROM channels WHERE code=$1', [code]))[0]?.id;
  if (typeof id !== 'string') throw new Error(`HB129 has no channel ${code}`);
  return id;
}

/** Token nhân viên thật qua `POST /auth/login`; vai trò đổi trước khi đăng nhập (HB-013). */
export async function staffToken(role = 'MANAGER', username = 'h029-first'): Promise<string> {
  await rows('UPDATE users SET role=$1 WHERE username=$2', [role, username]);
  const response = await http().post('/api/v1/auth/login').send({ username, password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

/**
 * Giá **kênh đã bán** cho một đơn vị bán — gọi đúng engine giá của hệ thống với danh tính `SYSTEM`
 * (adapter OTA là principal `SYSTEM`; `POST /quotes` từ chối kênh OTA cho bearer). Event dùng số này
 * làm `amount`, nên AC1 đối chiếu được ledger mà không chép công thức giá vào test.
 */
export async function otaTotal(input: {
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  roomCount?: number;
}): Promise<number> {
  const service = app.get(RateQuoteService);
  const quote = await db.$transaction((tx) =>
    service.create(
      tx,
      { type: 'SYSTEM', id: 'hb129-quote' },
      {
        propertyId,
        roomTypeId: input.roomTypeId,
        channelCode: 'OTA_BOOKING',
        ratePlanCode: 'FLEX7',
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        adults: 2,
        children: 0,
        roomCount: input.roomCount ?? 1,
      },
    ),
  );
  return quote.total;
}

export type OtaEventType = 'booking.created' | 'booking.modified' | 'booking.cancelled';

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
  readonly bookingCode: string;
  readonly updatedAt?: string;
  readonly checkIn?: string;
  readonly checkOut?: string;
  readonly roomTypeCode?: string;
  readonly propertyCode?: string;
  readonly roomCount?: number;
  readonly adults?: number;
  readonly children?: number;
  readonly guestName?: string;
  readonly guestPhone?: string;
  readonly amount: number;
  readonly paymentCollected?: boolean;
  readonly note?: string;
}

/** Mặc định tường minh: giữ `draft` không phình độ phức tạp vì chuỗi `??`. */
function pick<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

/** Body **đúng** HB-120 `otaWebhookEventSchema` (strict); `raw` là chuỗi byte được ký. */
export function draft(input: EventDraft): {
  readonly body: OtaEventBody;
  readonly raw: string;
} {
  const provider = pick(input.provider, 'booking');
  const account = pick(input.account, accountOf(provider));
  const body: OtaEventBody = {
    eventType: pick(input.eventType, 'booking.created'),
    providerAccountId: account.accountId,
    providerBookingCode: input.bookingCode,
    providerUpdatedAt: pick(input.updatedAt, clock.now().toISOString()),
    propertyCode: pick(input.propertyCode, PROPERTY_CODE),
    roomTypeCode: pick(input.roomTypeCode, STD_CODE),
    checkIn: pick(input.checkIn, stay.checkIn),
    checkOut: pick(input.checkOut, stay.checkOut),
    adults: pick(input.adults, 2),
    children: pick(input.children, 0),
    roomCount: pick(input.roomCount, 1),
    guest: {
      fullName: pick(input.guestName, 'HB129 Synthetic Guest'),
      phone: pick(input.guestPhone, GUEST_PHONE),
    },
    amount: input.amount,
    currency: 'VND',
    paymentCollected: pick(input.paymentCollected, true),
    note: input.note,
  };
  return { body, raw: JSON.stringify(body) };
}

export function signatureOf(secret: string, timestamp: number, raw: string): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;
}

export interface Delivery {
  readonly provider: OtaProvider;
  readonly eventId: string;
  readonly raw: string;
  readonly account?: OtaAccount | undefined;
  readonly timestamp?: number | undefined;
}

export function deliver(delivery: Delivery): request.Test {
  const account = delivery.account ?? accountOf(delivery.provider);
  const timestamp = delivery.timestamp ?? Math.floor(clock.now().getTime() / 1000);
  const path = `/api/v1/integrations/ota/${delivery.provider}/bookings`;
  return http()
    .post(path)
    .set('Content-Type', 'application/json')
    .set('X-Pinehill-Signature', signatureOf(account.secret, timestamp, delivery.raw))
    .set('X-Pinehill-Key-Id', account.keyId)
    .set('X-Channel-Event-Id', delivery.eventId)
    .send(delivery.raw);
}

export const eventId = (suffix: string): string => `hb129-ev-${suffix}`;

/** Gửi một sự kiện qua webhook thật; trả `eventId` để ca gọi `applyEvent`. */
export async function sendEvent(
  suffix: string,
  input: EventDraft,
): Promise<{ readonly id: string; readonly body: OtaEventBody }> {
  const id = eventId(suffix);
  const { body, raw } = draft(input);
  const response = await deliver({
    provider: input.provider ?? 'booking',
    account: input.account,
    eventId: id,
    raw,
  });
  expect(response.status, `${suffix}: ${JSON.stringify(response.body)}`).toBe(202);
  return { id, body };
}

export async function applier(): Promise<OtaInboxApplier> {
  return loadApplier({ db, clock, ids, audit: new AuditWriter(clock) });
}

/** Áp một hàng inbox đã xác minh; kết quả parse theo hợp đồng `./contract.ts`. */
export async function applyEvent(id: string): Promise<OtaApplyResult> {
  return otaApplyResultSchema.parse(await (await applier()).applyEvent(id));
}

/** Gửi + áp một sự kiện; trả `bookingId` khi áp thành công. */
export async function applyNew(
  suffix: string,
  input: EventDraft,
): Promise<{ readonly id: string; readonly bookingId: string }> {
  const { id } = await sendEvent(suffix, input);
  const result = await applyEvent(id);
  expect(result.status, `${suffix} apply: ${String(result.reason)}`).toBe('APPLIED');
  if (result.bookingId === null) throw new Error(`HB129 ${suffix} applied without bookingId`);
  return { id, bookingId: result.bookingId };
}

/** Payload nghiệp vụ **đã chuẩn hoá** như `normalizeEvent` của HB-128 (`channelCode` + null hoá). */
export function normalized(body: OtaEventBody): Record<string, unknown> {
  return {
    ...body,
    channelCode: CHANNEL_CODE.booking,
    guest: { fullName: body.guest.fullName, phone: body.guest.phone ?? null },
    note: body.note ?? null,
  };
}

/**
 * Ghi thẳng một hàng inbox **đã xác minh** — chỉ dùng cho ca mà đường chữ ký không tạo ra được
 * (vd account bị gỡ khỏi cấu hình sau khi nhận). Hash là `sha256` trên payload chuẩn hoá.
 */
export async function insertInbox(input: {
  eventId: string;
  accountId: string;
  body: OtaEventBody;
}): Promise<void> {
  await rows(
    `INSERT INTO webhook_inbox(provider, provider_account_id, event_id, payload_hash, payload_json,
       signature_verified_at, available_at, created_at, updated_at)
     VALUES('booking',$1,$2,$3,$4,clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp())`,
    [
      input.accountId,
      input.eventId,
      createHash('sha256')
        .update(JSON.stringify(normalized(input.body)))
        .digest('hex'),
      JSON.stringify(normalized(input.body)),
    ],
  );
}

export {
  one,
  text,
  count,
  dayOf,
  instantOf,
  bookingOf,
  bookingById,
  paymentsOf,
  snapshotsOf,
} from './assertions.js';
export {
  chargesOf,
  roomsOf,
  assignmentsOf,
  inboxOf,
  tombstonesOf,
  watermarkOf,
} from './assertions.js';
export { allotmentOf, auditOf, casesOf, refundsOf, TableOutage } from './assertions.js';
export { countBookings, expectQuarantinedInbox, expectOtaCollect } from './assertions.js';
