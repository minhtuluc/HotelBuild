/**
 * HB-131 — test khoá giai đoạn A cho luật tồn đẩy ra kênh: quota 80% **mỗi** OTA (không giữ 20% cho
 * kênh trực tiếp), cam kết OTA đã xác nhận vẫn nhận khi quota hết/đóng bán, và đóng bán tự động
 * (pool ≤ `channel.lowInventoryThreshold` = 2) không bị vượt bởi lệnh mở thủ công.
 *
 * Quan sát qua HTTP thật + bảng `channel_allotments` (HB-121 thêm `manual_closed`, `auto_closed`,
 * `closed_by`). Đỏ dự kiến hiện tại: `POST /channels/{id}/sync` chưa có ⇒ 404.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { USERS, auth, http, insert, login, rows, seed, setup, teardown } from './fixture.js';
import { availabilityViewSchema, closureViewSchema } from './schemas.js';

// Migration + Postgres mất vài giây mỗi tệp; ngưỡng mặc định 5 giây quá ngắn.
vi.setConfig({ testTimeout: 60_000 });

let manager = '';
let closureTypeId = '';
let closureRoomIds: string[] = [];

beforeAll(async () => {
  await setup();
  manager = await login(USERS.manager);
  // Loại phòng riêng cho ca đóng bán: 5 phòng tại CS-01, tách khỏi seed chung.
  closureTypeId = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'DLX','Inventory test',2,450000,400000,800000) RETURNING id",
    [seed.propertyId],
  );
  for (const code of ['I1', 'I2', 'I3', 'I4', 'I5']) {
    closureRoomIds.push(
      await insert(
        'INSERT INTO rooms(property_id,room_type_id,code,name) VALUES($1,$2,$3,$3) RETURNING id',
        [seed.propertyId, closureTypeId, code],
      ),
    );
  }
}, 180_000);

afterAll(async () => {
  await teardown();
}, 60_000);

beforeEach(async () => {
  await rows("UPDATE rooms SET status='ACTIVE'");
  await rows('DELETE FROM channel_allotments');
  await rows('DELETE FROM channel_mappings');
  // Trigger chặn xoá booking đã thu tiền; fixture là owner của CSDL tạm nên TRUNCATE CASCADE.
  await rows('TRUNCATE bookings CASCADE');
});

function availability(channelCode: string, roomTypeId: string, checkIn: string, checkOut: string) {
  return http().get('/api/v1/inventory/availability').query({
    propertyId: seed.propertyId,
    roomTypeId,
    checkIn,
    checkOut,
    adults: 1,
    children: 0,
    roomCount: 1,
    channelCode,
  });
}

async function available(channelCode: string, roomTypeId: string, date: string): Promise<number> {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const response = await availability(channelCode, roomTypeId, date, next);
  // Loại phòng chỉ định mà hết chỗ trả 409 theo BR-INV-07 — nghĩa là tồn công bố 0.
  if (response.status === 409) return 0;
  expect(response.status).toBe(200);
  return availabilityViewSchema.parse(response.body).data[0]!.availableCount;
}

function syncRequest(from: string, to: string, roomTypeIds: string[]) {
  return http()
    .post(`/api/v1/channels/${seed.channels['OTA_BOOKING']}/sync`)
    .set(auth(manager))
    .set('Idempotency-Key', randomUUID())
    .send({ scope: 'RANGE', from, to, roomTypeIds });
}

async function closedRows(from: string, to: string) {
  return rows<{
    channel_id: string;
    date: string;
    is_closed: boolean;
    auto_closed: boolean;
    manual_closed: boolean;
  }>(
    `SELECT channel_id, to_char(date,'YYYY-MM-DD') AS date, is_closed, auto_closed, manual_closed
       FROM channel_allotments
      WHERE room_type_id=$1 AND date >= $2::date AND date < $3::date
      ORDER BY channel_id, date`,
    [closureTypeId, from, to],
  );
}

test('per-channel-quota-and-nonnegative-inventory', async () => {
  const date = '2027-07-01';
  // BR-CHAN-01: mỗi OTA có hạn mức riêng floor(80%) = 4 trên 5 phòng; kênh trực tiếp giữ đủ 5
  // (không khoá 20% cho trực tiếp).
  for (const code of ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'])
    expect(await available(code, seed.typeId, date)).toBe(4);
  for (const code of ['WEB', 'PHONE', 'WALKIN'])
    expect(await available(code, seed.typeId, date)).toBe(5);
  // DOR đếm theo giường: 6 giường ⇒ floor(4,8) = 4 cho OTA, 6 cho trực tiếp.
  expect(await available('OTA_BOOKING', seed.dormTypeId, date)).toBe(4);
  expect(await available('WEB', seed.dormTypeId, date)).toBe(6);

  // used có thể vượt allotment khi nhận cam kết OTA; tồn công bố luôn kẹp không âm.
  for (let i = 0; i < 5; i++) {
    const id = await insert(
      `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent,status,total_amount,deposit_amount,external_ref)
       VALUES($1,$2,$3,$4,$5,$6,$7,'2027-07-02',1,30,'CONFIRMED',450000,135000,$1) RETURNING id`,
      [
        `PH-261101-Q000${i}`,
        seed.guestId,
        seed.propertyId,
        seed.typeId,
        seed.ratePlanId,
        seed.channels['OTA_BOOKING'],
        date,
      ],
    );
    await insert(
      'INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night) VALUES($1,$2,1,450000) RETURNING id',
      [id, seed.typeId],
    );
  }
  await rows(
    'INSERT INTO channel_allotments(channel_id,room_type_id,date,allotment,used) VALUES($1,$2,$3,2,5)',
    [seed.channels['OTA_BOOKING'], seed.typeId, date],
  );
  await rows(
    'INSERT INTO channel_allotments(channel_id,room_type_id,date,allotment,used,is_closed,closed_at) VALUES($1,$2,$3,0,0,true,now())',
    [seed.channels['OTA_AGODA'], seed.typeId, date],
  );
  expect(await available('OTA_BOOKING', seed.typeId, date)).toBe(0);
  expect(await available('OTA_AGODA', seed.typeId, date)).toBe(0);
  const published = await rows<{ available: number }>(
    'SELECT greatest(0, least(5, allotment - used)) AS available FROM channel_allotments WHERE channel_id=$1 AND room_type_id=$2 AND date=$3',
    [seed.channels['OTA_BOOKING'], seed.typeId, date],
  );
  expect(Number(published[0]!.available)).toBe(0);

  // Thay đổi đã commit kích đồng bộ ngay (202) và không làm tồn công bố vượt quota.
  expect((await syncRequest(date, '2027-07-03', [seed.typeId])).status).toBe(202);
  expect(await available('OTA_BOOKING', seed.typeId, date)).toBe(0);
});

test('automatic-and-manual-closure', async () => {
  const from = '2027-05-01';
  const to = '2027-05-03';
  // pool = 5 > 2: chưa đóng.
  expect((await syncRequest(from, to, [closureTypeId])).status).toBe(202);
  expect(await closedRows(from, to)).toEqual([]);

  // Hạ pool xuống 2 ⇒ mọi OTA tự đóng đúng (loại phòng, đêm), kênh trực tiếp vẫn bán.
  await rows("UPDATE rooms SET status='MAINTENANCE' WHERE id = ANY($1::uuid[])", [
    closureRoomIds.slice(0, 3),
  ]);
  expect((await syncRequest(from, to, [closureTypeId])).status).toBe(202);
  const closed = await closedRows(from, to);
  expect(closed).toHaveLength(3 * 2);
  for (const row of closed) {
    expect(row).toMatchObject({ is_closed: true, auto_closed: true });
    expect(['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB']).toContain(
      Object.entries(seed.channels).find(([, id]) => id === row.channel_id)?.[0],
    );
  }
  // Tồn công bố về 0 cho OTA; trực tiếp vẫn thấy 2 phòng; đêm/loại khác không bị đóng oan.
  expect(await available('OTA_BOOKING', closureTypeId, from)).toBe(0);
  expect(await available('WEB', closureTypeId, from)).toBe(2);
  expect(await closedRows('2027-05-10', '2027-05-11')).toEqual([]);
  const otherType = await rows(
    'SELECT 1 FROM channel_allotments WHERE room_type_id<>$1 AND date >= $2::date AND date < $3::date AND is_closed',
    [closureTypeId, from, to],
  );
  expect(otherType).toEqual([]);

  // Tồn > 2 trở lại ⇒ mở lại tự động (không có đóng thủ công).
  await rows("UPDATE rooms SET status='ACTIVE' WHERE id = ANY($1::uuid[])", [closureRoomIds]);
  expect((await syncRequest(from, to, [closureTypeId])).status).toBe(202);
  for (const row of await closedRows(from, to))
    expect(row).toMatchObject({ is_closed: false, auto_closed: false });

  // Đóng thủ công một đêm vẫn giữ sau lần sync kế tiếp dù pool > 2.
  const manual = await http()
    .post(`/api/v1/channels/${seed.channels['OTA_BOOKING']}/sales-closure`)
    .set(auth(manager))
    .set('Idempotency-Key', randomUUID())
    .send({
      roomTypeId: closureTypeId,
      from,
      to: '2027-05-02',
      reason: 'Đóng theo yêu cầu vận hành',
    });
  expect(manual.status).toBe(200);
  expect((await syncRequest(from, to, [closureTypeId])).status).toBe(202);
  const afterManual = await closedRows(from, '2027-05-02');
  const manualRow = afterManual.find((row) => row.channel_id === seed.channels['OTA_BOOKING']);
  expect(manualRow).toMatchObject({ is_closed: true, manual_closed: true, auto_closed: false });
});

test('manual_reopen_respects_automatic_closure', async () => {
  const from = '2027-06-01';
  const to = '2027-06-02';
  // Đóng thủ công rồi mở thủ công khi pool > 2 ⇒ gỡ manual flag.
  const close = await http()
    .post(`/api/v1/channels/${seed.channels['OTA_BOOKING']}/sales-closure`)
    .set(auth(manager))
    .set('Idempotency-Key', randomUUID())
    .send({ roomTypeId: closureTypeId, from, to, reason: 'Đóng để kiểm tra' });
  expect(close.status).toBe(200);
  const closedView = closureViewSchema.parse(close.body);
  expect(closedView.rows).toHaveLength(1);
  expect(closedView.rows[0]).toMatchObject({ closed: true });
  expect(closedView.rows[0]!.manual.closed).toBe(true);
  const reopen = await http()
    .post(`/api/v1/channels/${seed.channels['OTA_BOOKING']}/sales-closure`)
    .set(auth(manager))
    .set('Idempotency-Key', randomUUID())
    .send({ roomTypeId: closureTypeId, from, to, reason: 'Mở lại', closed: false });
  expect(reopen.status).toBe(200);
  const reopenedView = closureViewSchema.parse(reopen.body);
  expect(reopenedView.rows).toHaveLength(1);
  expect(reopenedView.rows[0]).toMatchObject({ closed: false });
  expect(reopenedView.rows[0]!.manual.closed).toBe(false);
  expect(reopenedView.rows[0]!.automatic.closed).toBe(false);
  const reopenedRows = await closedRows(from, to);
  expect(reopenedRows).toHaveLength(1);
  expect(reopenedRows[0]).toMatchObject({
    channel_id: seed.channels['OTA_BOOKING'],
    is_closed: false,
    manual_closed: false,
  });

  // pool ≤ 2: đóng tự động; lệnh mở thủ công chỉ gỡ manual, KHÔNG vượt auto closure/quota.
  const autoFrom = '2027-06-03';
  const autoTo = '2027-06-05';
  await rows("UPDATE rooms SET status='MAINTENANCE' WHERE id = ANY($1::uuid[])", [
    closureRoomIds.slice(0, 3),
  ]);
  expect((await syncRequest(autoFrom, autoTo, [closureTypeId])).status).toBe(202);
  const reopenAttempt = await http()
    .post(`/api/v1/channels/${seed.channels['OTA_BOOKING']}/sales-closure`)
    .set(auth(manager))
    .set('Idempotency-Key', randomUUID())
    .send({
      roomTypeId: closureTypeId,
      from: autoFrom,
      to: autoTo,
      reason: 'Mở lại',
      closed: false,
    });
  expect(reopenAttempt.status).toBe(200);
  for (const row of closureViewSchema.parse(reopenAttempt.body).rows) {
    expect(row.closed).toBe(true);
    expect(row.manual.closed).toBe(false);
    expect(row.automatic.closed).toBe(true);
  }
  for (const row of await closedRows(autoFrom, autoTo))
    expect(row).toMatchObject({ is_closed: true, manual_closed: false, auto_closed: true });
  expect(await available('OTA_BOOKING', closureTypeId, autoFrom)).toBe(0);
});
