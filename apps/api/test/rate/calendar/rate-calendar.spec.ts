/**
 * HB-054 AC1 — lịch giá theo loại phòng (đọc) trên PG16 + Redis thật, không mock engine:
 * mọi con số trong bài là số học BR-RATE-01…04 viết thẳng trong test.
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from 'vitest';
import { rateCalendarSchema } from '@pinehill/contracts';
import { calendarRequest } from './requests.js';
import {
  STD,
  http,
  insertCalendar,
  insertOccupancy,
  insertSeason,
  login,
  longstayPlanId,
  propertyId,
  rows,
  typeId,
} from './fixture.js';

const RANGE = { from: '2026-12-24', to: '2026-12-26' } as const;

test('AC1 — GET trả giá từng ngày kèm source và mùa thắng do engine HB-052 phân giải', async () => {
  const seasonId = await insertSeason({
    code: 'SE-NY',
    name: 'Cao điểm lễ 2026',
    startDate: '2026-12-24',
    endDate: '2026-12-26',
    multiplier: 2,
    priority: 90,
    weekendSurchargeEnabled: false,
  });
  for (const date of ['2026-12-24', '2026-12-25', '2026-12-26'])
    await insertCalendar({ date, price: STD.basePrice, source: 'SEASON', seasonId });
  await insertCalendar({
    date: '2026-12-25',
    price: 800_000,
    source: 'OVERRIDE',
    reason: 'Synthetic HB054',
  });

  const response = await calendarRequest(await login(), typeId, RANGE);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const body = rateCalendarSchema.parse(response.body);
  expect(body.roomTypeId).toBe(typeId);
  expect(body.entries.map((entry) => entry.date)).toEqual([
    '2026-12-24',
    '2026-12-25',
    '2026-12-26',
  ]);
  // BR-RATE-01: 650.000 × mùa 2,00 (mùa tắt phụ thu cuối tuần) → làm tròn lên 1.000 ⇒ 1.300.000.
  expect(body.entries[0]).toMatchObject({
    date: '2026-12-24',
    source: 'SEASON',
    seasonName: 'Cao điểm lễ 2026',
    basePrice: STD.basePrice,
    seasonMultiplier: 2,
    weekendMultiplier: 1,
    occupancyMultiplier: 1,
    losMultiplier: 1,
    channelMultiplier: 1,
    clamped: false,
    nightlyPrice: 1_300_000,
  });
  // BR-RATE-02: OVERRIDE (100) thắng SEASON (50) ở giá cơ bản; hệ số mùa vẫn áp ở bước 2.
  expect(body.entries[1]).toMatchObject({
    date: '2026-12-25',
    source: 'OVERRIDE',
    basePrice: 800_000,
    seasonName: 'Cao điểm lễ 2026',
    nightlyPrice: 1_600_000,
  });
  expect(body.entries[2]).toMatchObject({ date: '2026-12-26', source: 'SEASON' });
  // `LONGSTAY14` đang bán mà không có giá riêng ⇒ cảnh báo BR-RATE-19 luôn có trong phản hồi.
  expect(body.warnings).toHaveLength(1);
  expect(body.warnings![0]).toContain('LONGSTAY14');
});

test('AC1 — ngày không có dòng lịch giá dùng giá cơ bản loại phòng và báo nguồn BASE', async () => {
  const token = await login();
  const plain = rateCalendarSchema.parse(
    (await calendarRequest(token, typeId, { from: '2027-01-10', to: '2027-01-10' })).body,
  );
  expect(plain.entries).toEqual([
    {
      date: '2027-01-10',
      basePrice: STD.basePrice,
      seasonMultiplier: 1,
      weekendMultiplier: 1,
      occupancyMultiplier: 1,
      losMultiplier: 1,
      channelMultiplier: 1,
      clamped: false,
      nightlyPrice: STD.basePrice,
      source: 'BASE',
    },
  ]);

  // Hệ số cuối tuần (BR-RATE-06: Thứ Sáu/Thứ Bảy) do engine áp, không phải tầng API.
  const friday = rateCalendarSchema.parse(
    (await calendarRequest(token, typeId, { from: '2026-12-25', to: '2026-12-25' })).body,
  );
  expect(friday.entries[0]).toMatchObject({ weekendMultiplier: 1.2, nightlyPrice: 780_000 });
});

test('AC1 — hệ số công suất lấy từ snapshot toàn cơ sở còn tươi (BR-RATE-01 bước 4)', async () => {
  const token = await login();
  await insertCalendar({ date: '2027-01-10', price: STD.basePrice, source: 'BASE' });
  await insertOccupancy({
    date: '2027-01-10',
    physical: 100,
    sold: 96,
    capturedAt: new Date(Date.now() - 1000).toISOString(),
  });
  const fresh = rateCalendarSchema.parse(
    (await calendarRequest(token, typeId, { from: '2027-01-10', to: '2027-01-10' })).body,
  );
  expect(fresh.entries[0]).toMatchObject({ occupancyMultiplier: 1.25, nightlyPrice: 813_000 });

  // Snapshot cũ hơn 5 phút ⇒ hệ số về 1,00 (BR-RATE-01 §4.3).
  await rows("UPDATE occupancy_snapshots SET captured_at=now() - interval '10 minutes'");
  const stale = rateCalendarSchema.parse(
    (await calendarRequest(token, typeId, { from: '2027-01-10', to: '2027-01-10' })).body,
  );
  expect(stale.entries[0]).toMatchObject({ occupancyMultiplier: 1, nightlyPrice: STD.basePrice });
});

test('AC1 — lọc theo source chỉ trả ngày có nguồn đó', async () => {
  const token = await login();
  await insertCalendar({ date: '2026-12-25', price: STD.basePrice, source: 'BASE' });
  await insertCalendar({
    date: '2026-12-26',
    price: 900_000,
    source: 'OVERRIDE',
    reason: 'Synthetic HB054',
  });
  const filtered = await calendarRequest(token, typeId, { ...RANGE, source: 'OVERRIDE' });
  expect(filtered.status).toBe(200);
  expect(rateCalendarSchema.parse(filtered.body).entries.map((entry) => entry.date)).toEqual([
    '2026-12-26',
  ]);
});

test('AC2/BR-RATE-19 — warnings[] nêu LONGSTAY14 chưa có giá riêng, biến mất khi có dòng RATE_PLAN', async () => {
  const token = await login();
  const withWarning = rateCalendarSchema.parse((await calendarRequest(token, typeId, RANGE)).body);
  expect(withWarning.warnings).toHaveLength(1);
  expect(withWarning.warnings![0]).toContain('LONGSTAY14');
  expect(withWarning.warnings![0]).toContain('BR-RATE-19');

  await rows(
    "INSERT INTO rate_calendars(room_type_id,property_id,date,price,source,priority,rate_plan_id) VALUES($1,$2,'2026-12-25',1234000,'RATE_PLAN',90,$3)",
    [typeId, propertyId, longstayPlanId],
  );
  const body = rateCalendarSchema.parse((await calendarRequest(token, typeId, RANGE)).body);
  expect(body.warnings ?? []).toEqual([]);
  // Dòng RATE_PLAN thuộc một gói giá cụ thể, không tham gia lịch giá theo loại phòng (README).
  expect(body.entries[1]).toMatchObject({ date: '2026-12-25', source: 'BASE' });
});

test('AC1/BR-RATE-02 — dòng RATE_PLAN của **mọi** gói đang bán không tham gia lịch giá theo loại phòng', async () => {
  const token = await login();
  // Gói giá mặc định mà loader chuẩn phân giải có thể là bất kỳ gói ACTIVE nào, nên chèn dòng RATE_PLAN
  // (priority 90) cho **tất cả** gói: dù engine có nhận gói thật thì đêm này cũng bị dòng đó chiếm.
  await rows(
    "INSERT INTO rate_calendars(room_type_id,property_id,date,price,source,priority,rate_plan_id) SELECT $1,$2,'2027-01-10',1234000,'RATE_PLAN',90,id FROM rate_plans WHERE status='ACTIVE'",
    [typeId, propertyId],
  );
  const body = rateCalendarSchema.parse(
    (await calendarRequest(token, typeId, { from: '2027-01-10', to: '2027-01-10' })).body,
  );
  expect(body.entries[0]).toMatchObject({
    date: '2027-01-10',
    source: 'BASE',
    basePrice: STD.basePrice,
    nightlyPrice: STD.basePrice,
  });
});

test('AC1/BR-RATE-19 — không còn gói giá ACTIVE vẫn phục vụ lịch giá bằng gói trung tính', async () => {
  const token = await login();
  const range = { from: '2027-01-10', to: '2027-01-10' } as const;
  const withPlans = rateCalendarSchema.parse((await calendarRequest(token, typeId, range)).body);
  const plans = await rows('SELECT id::text AS id, status FROM rate_plans ORDER BY id');
  try {
    // OWNER có thể cho cả bốn gói về `INACTIVE` qua `PUT /rate-plans/admin`: lịch giá không được hỏng.
    await rows("UPDATE rate_plans SET status='INACTIVE'");
    const response = await calendarRequest(token, typeId, range);
    expect(response.status).toBe(200);
    const withoutPlans = rateCalendarSchema.parse(response.body);
    // Gói trung tính: khung ngày và từng trường của entry không đổi so với khi còn gói đang bán.
    expect(withoutPlans.roomTypeId).toBe(withPlans.roomTypeId);
    expect(withoutPlans.from).toBe(withPlans.from);
    expect(withoutPlans.to).toBe(withPlans.to);
    expect(withoutPlans.entries).toEqual(withPlans.entries);
    expect(withoutPlans.entries[0]).toMatchObject({
      date: '2027-01-10',
      source: 'BASE',
      basePrice: STD.basePrice,
      nightlyPrice: STD.basePrice,
    });
    // BR-RATE-19 chỉ nói về gói **đang bán**: hết gói ACTIVE thì không còn cảnh báo LONGSTAY14.
    expect(withoutPlans.warnings ?? []).toEqual([]);
  } finally {
    for (const plan of plans)
      await rows('UPDATE rate_plans SET status=$1 WHERE id=$2', [plan.status, plan.id]);
  }
});

test('đầu vào hỏng — query sai là 400, loại phòng không tồn tại là 404', async () => {
  const token = await login();
  const badQueries: readonly Record<string, unknown>[] = [
    {},
    { from: '2026-12-24' },
    { from: '2026-12-26', to: '2026-12-24' },
    { ...RANGE, source: 'NOPE' },
    { ...RANGE, roomTypeId: 'x' },
    { from: '2027-01-01', to: '2028-02-05' },
    { from: '2026-02-30', to: '2026-03-02' },
  ];
  for (const query of badQueries)
    expect((await calendarRequest(token, typeId, query)).status, JSON.stringify(query)).toBe(400);
  expect((await calendarRequest(token, randomUUID(), RANGE)).status).toBe(404);
  expect((await calendarRequest(token, 'not-a-uuid', RANGE)).status).toBe(400);
  // Biên trên: 366 ngày (bao gồm hai đầu) vẫn phục vụ được.
  expect(
    (await calendarRequest(token, typeId, { from: '2027-01-01', to: '2028-01-01' })).status,
  ).toBe(200);
});

test('đọc lịch giá không ghi gì', async () => {
  const token = await login();
  const facts = async () => ({
    calendar: await rows('SELECT id, price::text AS price FROM rate_calendars ORDER BY id'),
    audit: await rows("SELECT id FROM audit_logs WHERE action='RATE_CALENDAR_OVERRIDDEN'"),
    outbox: await rows('SELECT id FROM outbox_events ORDER BY id'),
    claims: await rows('SELECT id FROM idempotency_keys ORDER BY id'),
  });
  const before = await facts();
  expect((await calendarRequest(token, typeId, RANGE)).status).toBe(200);
  expect(await facts()).toEqual(before);
});

test('RBAC — MANAGER đọc được cơ sở trong phạm vi, cơ sở khác là 403', async () => {
  expect((await http().get(`/api/v1/room-types/${typeId}/rate-calendar`).query(RANGE)).status).toBe(
    401,
  );
  expect((await calendarRequest(await login('FRONT_DESK'), typeId, RANGE)).status).toBe(403);
  expect((await calendarRequest(await login('MANAGER'), typeId, RANGE)).status).toBe(200);
});
