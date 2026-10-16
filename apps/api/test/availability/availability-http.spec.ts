import pg from 'pg';
import { z } from 'zod';
import { expect, test, beforeAll } from 'vitest';
import { availabilitySchema, errorBodySchema } from '@pinehill/contracts';
import { seedReferenceData } from '../../prisma/seed/index.js';
import type { SeedSummary } from '../../prisma/seed/index.js';
import { databaseUrl } from '../idempotency/database.js';
import { http } from '../room-blocks/http-fixture.js';
import { PUBLIC_REQUEST_LIMIT } from '../../src/modules/inv/availability/rate-limit.js';
import {
  rows,
  propertyId,
  otherPropertyId,
  typeId,
  dormTypeId,
  otherTypeId,
  roomId,
  room2Id,
  dormId,
  booking,
  assign,
  block,
  allotment,
} from '../room-blocks/inventory-seed.js';

/**
 * Hình dạng công khai: đúng trường hợp đồng, không rò số tồn theo đêm (`supply`/`pool`/`physical`)
 * — điều kiện AC1 của HB-075 theo ví dụ api.md §3.8.
 */
const publicItemSchema = z.strictObject({
  propertyId: z.string().min(1),
  roomTypeId: z.string().min(1),
  roomTypeCode: z.string().min(1),
  roomTypeName: z.string().min(1),
  capacityAdults: z.number().int().min(1),
  availableCount: z.number().int().min(0),
  soldOut: z.boolean(),
  minNights: z.number().int().min(1),
  maxNights: z.number().int().min(1),
  nightlyFrom: z.number().int().positive(),
  totalFrom: z.number().int().positive(),
});
const publicBodySchema = z.strictObject({
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number().int().min(1),
  channelCode: z.string().optional(),
  data: z.array(publicItemSchema),
  meta: z.strictObject({
    limit: z.number().int().min(1),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    total: z.number().int().min(0).optional(),
  }),
});
type PublicBody = z.infer<typeof publicBodySchema>;

function availability(extra: Record<string, string | number> = {}) {
  return http()
    .get('/api/v1/inventory/availability')
    .query({
      propertyId,
      checkIn: '2026-11-01',
      checkOut: '2026-11-04',
      adults: 2,
      children: 0,
      roomCount: 1,
      ...extra,
    });
}

/** Tồn khả dụng của một loại phòng trong phản hồi đã kiểm hình dạng. */
function countOf(body: PublicBody, roomTypeCode: string): number {
  const item = body.data.find((row) => row.roomTypeCode === roomTypeCode);
  expect(item, `thiếu loại phòng ${roomTypeCode}`).toBeDefined();
  return item!.availableCount;
}

/**
 * Dữ liệu tham chiếu HB-018 (55 phòng / 75 đơn vị bán) **và** cấu hình giá đi kèm (4 gói giá,
 * `CP-FLEX7.is_default`, các `system_settings` `pricing.*`). Cần cho mọi test vì trường tiền của
 * endpoint do engine HB-052 + loader HB-056 quyết, không tự tính ở đây.
 */
let reference: SeedSummary;
beforeAll(async () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    reference = await seedReferenceData(client);
  } finally {
    await client.end();
  }
});

test('công khai không cần Bearer; chỉ trả trường hợp đồng và tồn theo đơn vị bán (BR-INV-07, §3.8)', async () => {
  const response = await availability();
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(availabilitySchema.safeParse(response.body).success).toBe(true);
  const body = publicBodySchema.parse(response.body);
  expect(body).toMatchObject({ checkIn: '2026-11-01', checkOut: '2026-11-04', nights: 3 });
  expect(body.channelCode).toBeUndefined();
  expect(body.data.map((item) => [item.roomTypeCode, item.availableCount, item.soldOut])).toEqual([
    // DOR: 1 phòng vật lý nhưng bán theo 6 giường (BR-PROP-04).
    ['DOR', 6, false],
    // STD: 2 phòng R1, R2, mỗi phòng một đơn vị bán.
    ['STD', 2, false],
  ]);
  expect(body.data.every((item) => item.totalFrom >= item.nightlyFrom)).toBe(true);
  expect(body.meta).toEqual({ limit: 20, nextCursor: null, hasMore: false, total: 2 });
});

test('ba kỳ mẫu khớp tính tay: đêm bị chặn, hold chưa gán và hạn mức kênh OTA (BR-INV-01/07)', async () => {
  // STD: R1 bị chặn đêm 01/11; một booking CONFIRMED kênh WEB 02/11 → 04/11.
  await block(roomId, '2026-11-01', '2026-11-02');
  await booking({ start: '2026-11-02', end: '2026-11-04' });
  // DOR: một hold còn hiệu lực, **chưa** sinh RoomAssignment ⇒ vẫn là nhu cầu (BR-INV-01).
  await booking({
    type: dormTypeId,
    status: 'HELD',
    deadline: new Date(Date.now() + 3_600_000),
  });
  // STD/đêm 01/11 bị đóng riêng cho kênh OTA_BOOKING.
  await allotment('OTA_BOOKING', 0);

  /* Kỳ A 01/11 → 04/11 (3 đêm).
     STD: supply 1,2,2 (chặn R1 đêm 1) · demand 0,1,1 (booking WEB) ⇒ pool 1,1,1.
       WEB (kênh trực tiếp = tồn chung): min = 1 · OTA_BOOKING: đêm 1 hạn mức 0 ⇒ min = 0.
     DOR: supply 6,6,6 · demand 1,1,1 (hold) ⇒ pool 5,5,5.
       WEB: 5 · OTA_BOOKING: quota mặc định 80% của 6 = 4 ⇒ min(5,4) = 4. */
  const webA = publicBodySchema.parse((await availability()).body);
  expect(countOf(webA, 'STD')).toBe(1);
  expect(countOf(webA, 'DOR')).toBe(5);
  const otaA = publicBodySchema.parse((await availability({ channelCode: 'OTA_BOOKING' })).body);
  expect(otaA.channelCode).toBe('OTA_BOOKING');
  expect(countOf(otaA, 'STD')).toBe(0);
  expect(countOf(otaA, 'DOR')).toBe(4);

  /* Kỳ B 03/11 → 05/11 (2 đêm).
     STD demand đêm 3 = 1 (booking kết thúc 04/11 nửa mở) ⇒ pool 1,2 ⇒ min = 1.
     DOR đêm 3 demand 1 ⇒ pool 5; đêm 4 hold đã hết (checkOut 04/11) ⇒ pool 6 ⇒ min = 5. */
  const webB = publicBodySchema.parse(
    (await availability({ checkIn: '2026-11-03', checkOut: '2026-11-05' })).body,
  );
  expect(webB.nights).toBe(2);
  expect(countOf(webB, 'STD')).toBe(1);
  expect(countOf(webB, 'DOR')).toBe(5);

  /* Kỳ C 04/11 → 06/11: cả hai biên đều nửa mở nên không đêm nào bị trừ ⇒ STD 2, DOR 6. */
  const webC = publicBodySchema.parse(
    (await availability({ checkIn: '2026-11-04', checkOut: '2026-11-06' })).body,
  );
  expect(countOf(webC, 'STD')).toBe(2);
  expect(countOf(webC, 'DOR')).toBe(6);
}, 30000);

test('kênh OTA ngừng bán: availableCount = 0 dù tồn chung còn nguyên (api.md §3.8)', async () => {
  await rows("UPDATE channels SET status='INACTIVE' WHERE code='OTA_BOOKING'");
  try {
    const ota = publicBodySchema.parse((await availability({ channelCode: 'OTA_BOOKING' })).body);
    expect(countOf(ota, 'STD')).toBe(0);
    expect(countOf(ota, 'DOR')).toBe(0);
    expect(ota.data.every((item) => item.soldOut)).toBe(true);
  } finally {
    await rows("UPDATE channels SET status='ACTIVE' WHERE code='OTA_BOOKING'");
  }
  // Kênh ngừng bán không làm giảm tồn chung của kênh trực tiếp.
  expect(countOf(publicBodySchema.parse((await availability()).body), 'STD')).toBe(2);
});

test('một đêm hết phòng: loại vẫn được trả về với soldOut, yêu cầu rõ loại thì 409 (BR-INV-07)', async () => {
  await block(roomId, '2026-11-02', '2026-11-03');
  await block(room2Id, '2026-11-02', '2026-11-03');
  const all = publicBodySchema.parse((await availability()).body);
  expect(countOf(all, 'STD')).toBe(0);
  expect(all.data.find((item) => item.roomTypeCode === 'STD')!.soldOut).toBe(true);
  // Kỳ chỉ khả dụng khi **mọi** đêm còn phòng, nhưng đêm khác vẫn còn nên loại khác không bị ảnh hưởng.
  expect(countOf(all, 'DOR')).toBe(6);
  const explicit = await availability({ roomTypeId: typeId, roomCount: 1 });
  expect(explicit.status).toBe(409);
  expect(errorBodySchema.parse(explicit.body).code).toBe('E_INV_NO_AVAILABILITY');
  // Kỳ khác không chạm đêm đã hết vẫn bán được.
  expect(
    (await availability({ roomTypeId: typeId, checkIn: '2026-11-03', checkOut: '2026-11-04' }))
      .status,
  ).toBe(200);
});

test('DOR bán theo giường: giữ một giường chỉ trừ một đơn vị bán (BR-PROP-04)', async () => {
  const dorm = async () => {
    const response = await availability({ roomTypeId: dormTypeId });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return countOf(publicBodySchema.parse(response.body), 'DOR');
  };
  // 1 phòng vật lý × 6 giường = 6 đơn vị bán.
  expect(await dorm()).toBe(6);
  // Chặn phòng là chặn cả 6 giường; yêu cầu rõ loại nên không còn đơn vị nào ⇒ 409 (BR-INV-07).
  await block(dormId, '2026-11-01', '2026-11-04');
  const blocked = await availability({ roomTypeId: dormTypeId });
  expect(blocked.status).toBe(409);
  expect(errorBodySchema.parse(blocked.body).code).toBe('E_INV_NO_AVAILABILITY');
  await rows('DELETE FROM room_blocks');
  // Giữ **một** giường chỉ trừ đúng một đơn vị bán, không khoá cả phòng.
  const held = await booking({
    type: dormTypeId,
    status: 'HELD',
    deadline: new Date(Date.now() + 3_600_000),
  });
  await assign(held.room, dormId, '2026-11-01', '2026-11-04', 3);
  expect(await dorm()).toBe(5);
});

test('danh sách sắp theo code,id; phân trang con trỏ limit/cursor và con trỏ hỏng bị từ chối', async () => {
  const page = publicBodySchema.parse((await availability({ limit: 1 })).body);
  expect(page.data.map((item) => item.roomTypeCode)).toEqual(['DOR']);
  expect(page.meta).toMatchObject({ limit: 1, hasMore: true, total: 2 });
  expect(page.meta.nextCursor).not.toBeNull();
  const tail = publicBodySchema.parse(
    (await availability({ limit: 1, cursor: page.meta.nextCursor! })).body,
  );
  expect(tail.data.map((item) => item.roomTypeCode)).toEqual(['STD']);
  expect(tail.meta).toMatchObject({ hasMore: false, nextCursor: null });
  expect((await availability({ cursor: 'not-a-cursor' })).status).toBe(400);
});

test('phạm vi cơ sở: loại phòng cơ sở khác, cơ sở lạ và cơ sở không có loại phòng đều 404', async () => {
  expect((await availability({ roomTypeId: otherTypeId })).status).toBe(404);
  expect((await availability({ roomTypeId: roomId })).status).toBe(404);
  expect((await availability({ propertyId: '00000000-0000-4000-8000-000000000000' })).status).toBe(
    404,
  );
  const empty = String(
    (
      await rows(
        "INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES('HB075-EMPTY','Synthetic','Synthetic','Synthetic',0,0) RETURNING id",
      )
    )[0]!.id,
  );
  expect((await availability({ propertyId: empty })).status).toBe(404);
  // Cơ sở khác đọc được **tồn của chính nó** (1 phòng) mà không lộ gì của cơ sở đang hỏi.
  const other = publicBodySchema.parse(
    (await availability({ propertyId: otherPropertyId, roomTypeId: otherTypeId })).body,
  );
  expect(other.data.map((item) => [item.roomTypeId, item.availableCount])).toEqual([
    [otherTypeId, 1],
  ]);
});

test('sức chứa theo BR-BOOK-04: vượt sức chứa loại phòng chỉ định trả 422, tìm cả cơ sở thì loại quá nhỏ', async () => {
  const over = await availability({ roomTypeId: typeId, adults: 3, roomCount: 1 });
  expect(over.status).toBe(422);
  expect(errorBodySchema.parse(over.body).code).toBe('E_BOOK_OVER_CAPACITY');
  expect((await availability({ roomTypeId: typeId, adults: 4, roomCount: 2 })).status).toBe(200);
  const search = publicBodySchema.parse((await availability({ adults: 3 })).body);
  expect(search.data).toEqual([]);
  expect(search.meta.total).toBe(0);
});

test('biên đầu vào: khoảng ngày rỗng/ngược, ngày không có thật và tham số thiếu đều 400', async () => {
  expect((await availability({ checkIn: '2026-11-04', checkOut: '2026-11-04' })).status).toBe(400);
  expect((await availability({ checkIn: '2026-11-05', checkOut: '2026-11-04' })).status).toBe(400);
  expect((await availability({ checkIn: '2026-02-30' })).status).toBe(400);
  expect((await availability({ propertyId: 'not-a-uuid' })).status).toBe(400);
  expect((await http().get('/api/v1/inventory/availability').query({ propertyId })).status).toBe(
    400,
  );
});

test('chỉ đọc: không ghi AuditLog/Idempotency và không đổi cấu hình tồn', async () => {
  const snapshot = () =>
    rows(`SELECT
      (SELECT count(*) FROM audit_logs) AS audit,
      (SELECT count(*) FROM idempotency_keys) AS keys,
      (SELECT count(*) FROM channel_allotments) AS allotments`);
  const before = await snapshot();
  expect((await availability()).status).toBe(200);
  expect(await snapshot()).toEqual(before);
});

test('hạn mức cơ bản theo IP: lượt thứ 121 trong một phút trả 429 kèm Retry-After', async () => {
  const cheap = () => http().get('/api/v1/inventory/availability').query({ propertyId });
  for (let attempt = 0; attempt < PUBLIC_REQUEST_LIMIT; attempt++)
    expect((await cheap()).status).toBe(400);
  const limited = await cheap();
  expect(limited.status).toBe(429);
  expect(errorBodySchema.parse(limited.body).code).toBe('E_GEN_RATE_LIMITED');
  expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
}, 60000);

test('seed tham chiếu HB-018: 55 phòng/75 đơn vị bán và tồn WEB đúng BR-PROP-03/04', async () => {
  expect(reference.rooms).toBe(55);
  expect(reference.sellingUnits).toBe(75);
  const cs01 = String((await rows("SELECT id FROM properties WHERE code='CS-01'"))[0]!.id);
  const response = await http().get('/api/v1/inventory/availability').query({
    propertyId: cs01,
    checkIn: '2026-12-01',
    checkOut: '2026-12-04',
    adults: 2,
    children: 0,
    roomCount: 1,
    channelCode: 'WEB',
  });
  expect(response.status).toBe(200);
  const body = publicBodySchema.parse(response.body);
  expect(body.channelCode).toBe('WEB');
  expect(body.data.map((item) => [item.roomTypeCode, item.availableCount])).toEqual([
    ['DLX', 5],
    ['DOR', 12], // 2 phòng × 6 giường
    ['FAM', 3],
    ['STD', 8],
    ['SUP', 6],
  ]);
  // Gói mặc định của seed (`CP-FLEX7.is_default` ⇒ FLEX7: min 1, max 365) quyết cửa sổ số đêm.
  expect(body.data.every((item) => item.minNights === 1 && item.maxNights === 365)).toBe(true);
}, 30000);
