/**
 * F6 gap HB-134 — danh sách `GET /channels/{id}/ota-bookings` trả đúng `otaBookingSchema` (HB-120) trên
 * PostgreSQL/Redis thật: sự kiện inbox mới nhất, trạng thái xử lý, khoản thu OTA_COLLECT, mã chính sách huỷ
 * và liên kết case quá tải. Test khoá HB-131 vẫn chốt các trường cũ (`duplicateSuspected`…), tệp này chỉ thêm.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { z } from 'zod';
import { listResponseSchema, otaBookingSchema } from '@pinehill/contracts';
import { USERS, insert, booking, login, rows, seed, setup, teardown } from './fixture.js';
import { readChannel } from './http.js';

const page = listResponseSchema(otaBookingSchema);
const query = { from: '2027-05-01', to: '2027-05-31' };
const SECRET = { phone: '+84900000555', email: 'secret-555@example.com', signature: 'SIG-555' };

let manager = '';
const ids = { collected: '', cancelled: '', quarantined: '', bare: '' };

interface EventOptions {
  readonly code: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly status?: string;
  readonly error?: string | null;
  readonly createdAt: string;
}

async function event(options: EventOptions): Promise<void> {
  const status = options.status ?? 'PROCESSED';
  await rows(
    `INSERT INTO webhook_inbox(provider,provider_account_id,event_id,payload_hash,payload_json,signature_verified_at,status,processed_at,last_error,created_at)
     VALUES('booking','acct-555',$1,'hash',$2,now(),$3,CASE WHEN $3='PROCESSED' THEN now() END,$4,$5)`,
    [
      options.eventId,
      JSON.stringify({
        channelCode: 'OTA_BOOKING',
        eventType: options.eventType,
        providerAccountId: 'acct-555',
        providerBookingCode: options.code,
        propertyCode: 'CS-01',
        guest: { fullName: 'Khách Bí Mật', phone: SECRET.phone },
        guestEmail: SECRET.email,
        signature: SECRET.signature,
      }),
      status,
      options.error ?? null,
      options.createdAt,
    ],
  );
}

const ota = (code: string, extra: Partial<Parameters<typeof booking>[0]> = {}) =>
  booking({
    code: `PH-261107-${code.replace('-', '').slice(-5)}`,
    externalRef: `CS-01/acct-555/${code}`,
    checkIn: '2027-05-10',
    checkOut: '2027-05-12',
    ...extra,
  });

beforeAll(async () => {
  await setup();
  manager = await login(USERS.manager);
  ids.collected = await ota('OTA-100');
  await event({
    code: 'OTA-100',
    eventId: 'evt-100',
    eventType: 'booking.created',
    createdAt: '2027-05-01T01:00:00Z',
  });
  await rows(
    `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at)
     VALUES($1,'BALANCE','OTA_COLLECT',350000,'SUCCEEDED',$2,now()),
           ($1,'BALANCE','OTA_COLLECT',150000,'SUCCEEDED',$3,now()),
           ($1,'BALANCE','OTA_COLLECT',999999,'FAILED',$4,NULL)`,
    [ids.collected, randomUUID(), randomUUID(), randomUUID()],
  );

  ids.cancelled = await ota('OTA-200');
  await rows(
    "UPDATE bookings SET status='CANCELLED', cancelled_at=now(), channel_policy_code='OTA_CHANNEL' WHERE id=$1",
    [ids.cancelled],
  );
  await event({
    code: 'OTA-200',
    eventId: 'evt-200a',
    eventType: 'booking.created',
    createdAt: '2027-05-01T02:00:00Z',
  });
  await event({
    code: 'OTA-200',
    eventId: 'evt-200b',
    eventType: 'booking.cancelled',
    createdAt: '2027-05-02T02:00:00Z',
  });

  ids.quarantined = await ota('OTA-300');
  await rows('UPDATE bookings SET oversold=true WHERE id=$1', [ids.quarantined]);
  await event({
    code: 'OTA-300',
    eventId: 'evt-300a',
    eventType: 'booking.created',
    createdAt: '2027-05-01T03:00:00Z',
  });
  await event({
    code: 'OTA-300',
    eventId: 'evt-300b',
    eventType: 'booking.modified',
    status: 'DEAD_LETTER',
    error: 'E_CHAN_RESURRECTION',
    createdAt: '2027-05-03T03:00:00Z',
  });
  ids.bare = await ota('OTA-400');
}, 120_000);

afterAll(async () => {
  await teardown();
});

test('dòng khớp otaBookingSchema và giữ các trường HB-131', async () => {
  const body: unknown = (await readChannel(manager, 'ota-bookings').query(query)).body;
  const parsed = page.parse(body);
  expect(parsed.data.map((row) => row.id).sort()).toEqual(Object.values(ids).sort());
  // `parse` cắt khoá lạ, nên trường HB-131 (test khoá) phải kiểm trên thân thô.
  const raw = z.object({ data: z.array(z.looseObject({ id: z.string() })) }).parse(body).data;
  expect(raw.find((row) => row.id === ids.collected)).toMatchObject({
    code: 'PH-261107-TA100',
    externalRef: 'CS-01/acct-555/OTA-100',
    duplicateSuspected: false,
  });
});

test('sự kiện inbox mới nhất quyết định eventType, trạng thái xử lý và errorCode', async () => {
  const rowsById = new Map(
    page
      .parse((await readChannel(manager, 'ota-bookings').query(query)).body)
      .data.map((row) => [row.id, row]),
  );
  expect(rowsById.get(ids.collected)).toMatchObject({
    eventType: 'booking.created',
    providerEventId: 'evt-100',
    providerBookingCode: 'OTA-100',
    status: 'PROCESSED',
    bookingId: ids.collected,
    errorCode: null,
  });
  // Hai sự kiện của cùng booking: lấy sự kiện mới hơn (huỷ).
  expect(rowsById.get(ids.cancelled)).toMatchObject({
    eventType: 'booking.cancelled',
    providerEventId: 'evt-200b',
  });
  // DEAD_LETTER = cách ly bền ⇒ QUARANTINED kèm mã lý do.
  expect(rowsById.get(ids.quarantined)).toMatchObject({
    status: 'QUARANTINED',
    errorCode: 'E_CHAN_RESURRECTION',
    eventType: 'booking.modified',
    processedAt: null,
  });
  // Không có sự kiện khớp: không bịa loại/mã sự kiện.
  expect(rowsById.get(ids.bare)).toMatchObject({
    eventType: null,
    providerEventId: null,
    status: 'PROCESSED',
  });
});

test('thu hộ OTA_COLLECT: chỉ cộng khoản SUCCEEDED, không có khoản thì để null', async () => {
  const rowsById = new Map(
    page
      .parse((await readChannel(manager, 'ota-bookings').query(query)).body)
      .data.map((row) => [row.id, row]),
  );
  expect(rowsById.get(ids.collected)).toMatchObject({
    paymentMethod: 'OTA_COLLECT',
    collectedAmount: 500_000,
  });
  for (const id of [ids.cancelled, ids.quarantined, ids.bare])
    expect(rowsById.get(id), id).toMatchObject({ paymentMethod: null, collectedAmount: null });
});

test('mã chính sách huỷ và liên kết case quá tải lấy từ dữ liệu máy chủ', async () => {
  const caseId = await insert(
    "INSERT INTO overbooking_cases(property_id,date,room_type_id,shortage_count,status) VALUES($1,'2027-05-11',$2,1,'OPEN') RETURNING id",
    [seed.propertyId, seed.typeId],
  );
  // Case ngoài đêm lưu trú hoặc của booking không vượt tồn không được gắn nhầm.
  await rows(
    "INSERT INTO overbooking_cases(property_id,date,room_type_id,shortage_count,status) VALUES($1,'2027-05-12',$2,1,'OPEN')",
    [seed.propertyId, seed.typeId],
  );
  const rowsById = new Map(
    page
      .parse((await readChannel(manager, 'ota-bookings').query(query)).body)
      .data.map((row) => [row.id, row]),
  );
  expect(rowsById.get(ids.cancelled)).toMatchObject({
    channelPolicyCode: 'OTA_CHANNEL',
    overbookingCaseId: null,
  });
  expect(rowsById.get(ids.collected)).toMatchObject({
    channelPolicyCode: null,
    overbookingCaseId: null,
  });
  expect(rowsById.get(ids.quarantined)).toMatchObject({
    oversold: true,
    overbookingCaseId: caseId,
  });
});

test('lọc status theo trạng thái xử lý; payload/PII không lọt vào phản hồi', async () => {
  const quarantined = page.parse(
    (await readChannel(manager, 'ota-bookings').query({ ...query, status: 'QUARANTINED' })).body,
  );
  expect(quarantined.data.map((row) => row.id)).toEqual([ids.quarantined]);
  expect(quarantined.meta.total).toBe(1);
  const processed = page.parse(
    (await readChannel(manager, 'ota-bookings').query({ ...query, status: 'PROCESSED' })).body,
  );
  expect(processed.data.map((row) => row.id).sort()).toEqual(
    [ids.collected, ids.cancelled, ids.bare].sort(),
  );
  const everything = JSON.stringify((await readChannel(manager, 'ota-bookings').query(query)).body);
  for (const secret of [...Object.values(SECRET), 'Khách Bí Mật'])
    expect(everything).not.toContain(secret);
});
