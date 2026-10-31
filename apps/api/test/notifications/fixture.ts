import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';
import { tokenPairSchema, NOTIFICATION_MAX_RESENDS } from '@pinehill/contracts';
import { AppModule } from '../../src/app.module.js';
import { CLOCK } from '../../src/infrastructure/ports.js';
import { NOTIFICATION_QUEUE_NAME } from '../../src/modules/noti/queue.js';
import { NotificationGateway } from '../../src/modules/noti/gateway.js';
import { NotiModule } from '../../src/modules/noti/module.js';
import { databaseUrl, password } from '../idempotency/database.js';
import { rows, clock, userId, propertyId, otherPropertyId } from '../idempotency/database.js';

export { rows, clock, userId, propertyId, otherPropertyId, NOTIFICATION_MAX_RESENDS };

let app: NestFastifyApplication, redis: Redis, queue: Queue;

export const http = () => request(app.getHttpServer());
export const gateway = (): NotificationGateway => app.get(NotificationGateway);

/** Gật một hàng đợi BullMQ thật trỏ cùng Redis DB `/8` để đọc job API vừa phát. */
export function notificationJobs() {
  return queue.getJobs(['waiting', 'delayed', 'active', 'paused']);
}

export async function login(role = 'FRONT_DESK'): Promise<string> {
  // Đăng nhập nhiều vai trò liên tiếp trong một ca: đẩy đồng hồ giả để không chạm hạn mức đăng nhập
  // (cùng cách `test/rbac/registered-routes.spec.ts` làm).
  clock.value += 61000;
  await rows('UPDATE users SET role=$1 WHERE id=$2', [role, userId]);
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-first', password });
  expect(response.status).toBe(200);
  return tokenPairSchema.parse(response.body).accessToken;
}

export function listNotifications(token: string, query: Record<string, string> = {}) {
  return http().get('/api/v1/notifications').set('Authorization', `Bearer ${token}`).query(query);
}

/** Lệnh ghi nên luôn mang `Idempotency-Key` (api.md §3, BR-GEN-08); ca chống trùng truyền khoá cố định. */
export function resendNotification(
  token: string,
  notificationId: string,
  body: object,
  key = randomUUID(),
) {
  return http()
    .post(`/api/v1/notifications/${notificationId}/resend`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send(body);
}

export let bookingId = '',
  otherBookingId = '',
  guestId = '';

export interface NotificationSeed {
  readonly bookingId?: string | null;
  readonly recipient?: string;
  readonly channel?: string;
  readonly template?: string;
  readonly payload?: unknown;
  readonly status?: string;
  readonly sentAt?: Date | null;
  readonly retryCount?: number;
  readonly errorMessage?: string | null;
}

/** Chuẩn hóa `sent_at`: không có giá trị ⇒ `NULL`, ngược lại mốc ISO-8601. */
function sentAtIso(sentAt: Date | null | undefined): string | null {
  if (sentAt === undefined || sentAt === null) return null;
  return sentAt.toISOString();
}

/** Giá trị cột theo thứ tự câu `SEED_NOTIFICATION_SQL`, điền mặc định khi ca không truyền. */
function seedValues(seed: NotificationSeed): unknown[] {
  return [
    seed.bookingId === undefined ? bookingId : seed.bookingId,
    seed.recipient ?? '+84912345678',
    seed.channel ?? 'SMS',
    seed.template ?? 'booking-confirmed',
    JSON.stringify(seed.payload ?? {}),
    seed.status ?? 'PENDING',
    sentAtIso(seed.sentAt),
    seed.retryCount ?? 0,
    seed.errorMessage ?? null,
  ];
}

const SEED_NOTIFICATION_SQL = `INSERT INTO notifications(booking_id,recipient,channel,template,payload_json,status,
                                sent_at,retry_count,error_message,created_at)
     VALUES($1::uuid,$2,$3,$4,$5::jsonb,$6,$7::timestamptz,$8,$9,date_trunc('milliseconds', clock_timestamp()))
     RETURNING id`;

/** Gieo một `notifications` thô; mặc định `PENDING`, `retry_count` 0, payload rỗng. */
export async function seedNotification(seed: NotificationSeed = {}): Promise<string> {
  const created = await rows(SEED_NOTIFICATION_SQL, seedValues(seed));
  return String(created[0]!.id);
}

async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('HB-168 requires Redis7; no skip fallback');
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/8';
  redis = new Redis(url.href);
  await redis.ping();
  const policy = await insert(
    "INSERT INTO cancellation_policies(code,name) VALUES('HB168','Synthetic HB-168') RETURNING id",
  );
  const ratePlan = await insert(
    "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('SAVER3','Tiết kiệm',30,$1) RETURNING id",
    [policy],
  );
  const channel = await insert(
    "INSERT INTO channels(code,name,multiplier) VALUES('WEB','WEB',1) RETURNING id",
  );
  guestId = await insert(
    "INSERT INTO guests(full_name,phone) VALUES('Khách Thông Báo','+84916800001') RETURNING id",
  );
  const seedBooking = async (property: string): Promise<string> => {
    const typeId = await insert(
      "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Tiêu chuẩn',2,1000000,500000,2000000) RETURNING id",
      [property],
    );
    return insert(
      `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent,status)
       VALUES('PH-' || lpad((floor(random()*999999))::text,6,'0') || '-' || upper(substr(md5(random()::text),1,5)),$1,$2,$3,$4,$5,'2026-11-01','2026-11-03',2,30,'CONFIRMED') RETURNING id`,
      [guestId, property, typeId, ratePlan, channel],
    );
  };
  bookingId = await seedBooking(propertyId);
  otherBookingId = await seedBooking(otherPropertyId);
  const module = AppModule.register({
    DATABASE_URL: databaseUrl,
    REDIS_URL: url.href,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    IDEMPOTENCY_TTL_HOURS: 24,
    LOG_LEVEL: 'silent',
    HOST: '127.0.0.1',
    PORT: 0,
  });
  // Người tích hợp sẽ đăng ký `NotiModule` trong `app.module.ts`; fixture gắn thẳng để chạy độc lập.
  app = await NestFactory.create<NestFastifyApplication>(
    {
      ...module,
      imports: [...(module.imports ?? []), NotiModule],
      providers: [
        ...(module.providers ?? []).filter(
          (p) => typeof p !== 'object' || p === null || !('provide' in p) || p.provide !== CLOCK,
        ),
        { provide: CLOCK, useValue: clock },
      ],
    },
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  queue = new Queue(NOTIFICATION_QUEUE_NAME, {
    connection: { host: url.hostname, port: Number(url.port) || 6379, db: 8 },
  });
}, 60000);

beforeEach(async () => {
  await redis.flushdb();
  await rows('DELETE FROM notifications');
  // `updated_at` của hàng do trigger CSDL đặt theo giờ thật ⇒ đặt đồng hồ giả về giờ thật để mốc
  // 5 phút giữa các lượt gửi có nghĩa (xem service `NOTIFICATION_RESEND_INTERVAL_MS`).
  clock.value = Date.now();
});

afterAll(async () => {
  await queue?.close();
  await app?.close();
  await redis?.quit();
}, 30000);

export { randomUUID };
