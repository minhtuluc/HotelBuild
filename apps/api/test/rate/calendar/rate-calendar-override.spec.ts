/**
 * HB-054 AC2, AC4 — ghi đè lịch giá: OVERRIDE priority 100, sàn–trần, xác nhận ±20% của OWNER
 * (BR-RBAC-04/TC-AUTH-09), audit + RateChanged cùng transaction và snapshot báo giá đã chốt bất biến.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { test, expect } from 'vitest';
import { errorBodySchema, rateCalendarSchema } from '@pinehill/contracts';
import { calendarRequest, overrideAuditCount, overrideRequest } from './requests.js';
import {
  STD,
  bookedSnapshot,
  insertCalendar,
  login,
  otherTypeId,
  rows,
  typeId,
  userId,
} from './fixture.js';

const overrideSnapshot = z.object({
  roomTypeId: z.string(),
  channelCode: z.string().nullable(),
  overrides: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      price: z.string(),
      source: z.string(),
      channelCode: z.string().nullable(),
      priority: z.number(),
    }),
  ),
});

test('AC2 — PUT ghi OVERRIDE priority 100 và thay dòng ghi đè cũ cùng (ngày, kênh)', async () => {
  const token = await login('OWNER');
  const first = await overrideRequest(token, {
    items: [
      { date: '2026-12-25', price: 800_000 },
      { date: '2026-12-26', price: 700_000 },
    ],
    priority: 0,
    reason: 'Synthetic HB054 lần 1',
  });
  expect(first.status).toBe(200);
  const body = rateCalendarSchema.parse(first.body);
  expect([body.from, body.to]).toEqual(['2026-12-25', '2026-12-26']);
  expect(body.entries.map((entry) => [entry.date, entry.source, entry.basePrice])).toEqual([
    ['2026-12-25', 'OVERRIDE', 800_000],
    ['2026-12-26', 'OVERRIDE', 700_000],
  ]);
  expect(
    await rows(
      "SELECT to_char(date,'YYYY-MM-DD') AS day, price::text AS price, source, priority, channel_code FROM rate_calendars ORDER BY date",
    ),
  ).toEqual([
    { day: '2026-12-25', price: '800000', source: 'OVERRIDE', priority: 100, channel_code: null },
    { day: '2026-12-26', price: '700000', source: 'OVERRIDE', priority: 100, channel_code: null },
  ]);

  const second = await overrideRequest(token, {
    items: [{ date: '2026-12-25', price: 820_000 }],
    priority: 100,
    reason: 'Synthetic HB054 lần 2',
  });
  expect(second.status).toBe(200);
  // BR-RATE-02 chọn dòng cũ hơn khi cùng nguồn/kênh, nên lệnh mới phải thay (không xếp thêm) dòng cũ.
  expect(
    await rows(
      "SELECT to_char(date,'YYYY-MM-DD') AS day, price::text AS price FROM rate_calendars ORDER BY date",
    ),
  ).toEqual([
    { day: '2026-12-25', price: '820000' },
    { day: '2026-12-26', price: '700000' },
  ]);
});

test('AC2 — ghi đè theo kênh không đụng dòng mọi kênh', async () => {
  const token = await login('OWNER');
  await overrideRequest(token, {
    items: [{ date: '2026-12-25', price: 800_000 }],
    priority: 100,
    reason: 'Synthetic HB054 mọi kênh',
  });
  const scoped = await overrideRequest(token, {
    items: [{ date: '2026-12-25', price: 990_000 }],
    channelCode: 'OTA_BOOKING',
    priority: 100,
    reason: 'Synthetic HB054 OTA',
  });
  expect(scoped.status).toBe(200);
  expect(
    await rows(
      'SELECT channel_code, price::text AS price FROM rate_calendars ORDER BY channel_code NULLS FIRST',
    ),
  ).toEqual([
    { channel_code: null, price: '800000' },
    { channel_code: 'OTA_BOOKING', price: '990000' },
  ]);
  expect(rateCalendarSchema.parse(scoped.body).entries[0]).toMatchObject({
    basePrice: 990_000,
    channelMultiplier: 1.25,
  });
});

test('AC2 — audit và RateChanged nằm cùng transaction, reason che PII', async () => {
  const token = await login('OWNER');
  const baseline = await overrideAuditCount();
  const response = await overrideRequest(token, {
    items: [{ date: '2026-12-25', price: 800_000 }],
    priority: 100,
    reason: 'Synthetic HB054 +84 900 000 054',
  });
  expect(response.status).toBe(200);
  expect(await overrideAuditCount()).toBe(baseline + 1);

  const audit = (
    await rows(
      "SELECT entity_type, entity_id, before_json, after_json, reason FROM audit_logs WHERE action='RATE_CALENDAR_OVERRIDDEN' ORDER BY chain_seq DESC LIMIT 1",
    )
  )[0]!;
  expect(audit.entity_type).toBe('RateCalendar');
  expect(audit.entity_id).toBe(typeId);
  expect(String(audit.reason)).toBe('Synthetic HB054 ****0054');
  expect(overrideSnapshot.parse(audit.before_json).overrides).toEqual([]);
  expect(overrideSnapshot.parse(audit.after_json).overrides[0]).toMatchObject({
    date: '2026-12-25',
    price: '800000',
    source: 'OVERRIDE',
    channelCode: null,
    priority: 100,
  });

  expect(
    await rows(
      "SELECT event_type, aggregate_type, aggregate_id FROM outbox_events WHERE event_type='RateChanged'",
    ),
  ).toEqual([{ event_type: 'RateChanged', aggregate_type: 'RateCalendar', aggregate_id: typeId }]);
});

test('AC2 — giá ngoài [sàn, trần] là 422 E_RATE_CONFIGURATION_INVALID và không ghi gì', async () => {
  const token = await login('OWNER');
  const baseline = await overrideAuditCount();
  for (const [price, issue] of [
    [STD.minPrice - 1, 'BELOW_FLOOR'],
    [STD.maxPrice + 1, 'ABOVE_CEILING'],
  ] as const) {
    const response = await overrideRequest(token, {
      items: [{ date: '2027-01-10', price }],
      priority: 100,
      reason: 'Synthetic HB054 biên',
    });
    expect(response.status, `giá ${price}`).toBe(422);
    const error = errorBodySchema.parse(response.body);
    expect(error.code).toBe('E_RATE_CONFIGURATION_INVALID');
    expect(error.details).toEqual([{ field: 'items[0].price', issue }]);
  }
  expect(await overrideAuditCount()).toBe(baseline);
  expect(Number((await rows('SELECT count(*)::int AS n FROM rate_calendars'))[0]!.n)).toBe(0);
  expect(Number((await rows('SELECT count(*)::int AS n FROM outbox_events'))[0]!.n)).toBe(0);
});

test('AC2/TC-AUTH-09 — lệch quá ±20% cần OWNER xác nhận, đúng ±20% lưu bình thường', async () => {
  const token = await login('OWNER');
  const date = '2027-01-10';
  const shown = rateCalendarSchema.parse(
    (await calendarRequest(token, typeId, { from: date, to: date })).body,
  );
  const current = shown.entries[0]!.nightlyPrice;
  expect(current).toBe(STD.basePrice);
  const scenarios: readonly { price: number; needsConfirmation: boolean }[] = [
    // BR-RBAC-04: |mới − cũ| × 5 > cũ ⇒ cần xác nhận; đúng biên ±20% vẫn lưu bình thường (TC-AUTH-09).
    { price: current + current / 5, needsConfirmation: false },
    { price: current + current / 4, needsConfirmation: true },
    { price: current - current / 4, needsConfirmation: true },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const body = {
      items: [{ date, price: scenario.price }],
      priority: 100,
      reason: `Synthetic HB054 lệch ${index}`,
    };
    const refused = await overrideRequest(token, body);
    expect(refused.status, `ca ${index} (${scenario.price})`).toBe(
      scenario.needsConfirmation ? 422 : 200,
    );
    if (scenario.needsConfirmation) {
      const error = errorBodySchema.parse(refused.body);
      expect(error.code).toBe('E_RATE_CONFIGURATION_INVALID');
      expect(error.details).toEqual([
        { field: 'items[0].price', issue: 'OWNER_CONFIRMATION_REQUIRED' },
      ]);
      expect(Number((await rows('SELECT count(*)::int AS n FROM rate_calendars'))[0]!.n)).toBe(0);
      const confirmed = await overrideRequest(token, { ...body, confirmOwnerOverride: true });
      expect(confirmed.status).toBe(200);
      expect(rateCalendarSchema.parse(confirmed.body).entries[0]).toMatchObject({
        date,
        source: 'OVERRIDE',
        basePrice: scenario.price,
      });
    }
    await rows("DELETE FROM rate_calendars WHERE source='OVERRIDE'");
  }
});

test('AC2 — thân lệnh hỏng là 422 và không ghi gì', async () => {
  const token = await login('OWNER');
  const badBodies: readonly [Record<string, unknown>, string | undefined][] = [
    [{ items: [], priority: 100, reason: 'Synthetic HB054' }, undefined],
    [
      { items: [{ date: '2027-01-10', price: 700_000 }], priority: 100, reason: 'x', extra: 1 },
      undefined,
    ],
    [
      { items: [{ date: '2027-02-30', price: 700_000 }], priority: 100, reason: 'Synthetic HB054' },
      'INVALID_DATE',
    ],
    [
      {
        items: [
          { date: '2027-01-10', price: 700_000 },
          { date: '2027-01-10', price: 710_000 },
        ],
        priority: 100,
        reason: 'Synthetic HB054',
      },
      'DUPLICATE_DATE',
    ],
    [{ items: [{ date: '2027-01-10', price: 700_000 }], priority: 100, reason: '   ' }, 'REQUIRED'],
  ];
  for (const [body, issue] of badBodies) {
    const response = await overrideRequest(token, body);
    expect(response.status, JSON.stringify(body)).toBe(422);
    const error = errorBodySchema.parse(response.body);
    expect(error.code).toBe('E_RATE_CONFIGURATION_INVALID');
    if (issue !== undefined) expect(error.details?.[0]?.issue).toBe(issue);
  }
  expect(Number((await rows('SELECT count(*)::int AS n FROM rate_calendars'))[0]!.n)).toBe(0);
});

test('RBAC — chỉ OWNER ghi đè, phạm vi cơ sở và Idempotency-Key', async () => {
  const manager = await login('MANAGER');
  expect(
    (
      await overrideRequest(manager, {
        items: [{ date: '2027-01-10', price: 700_000 }],
        priority: 100,
        reason: 'Synthetic HB054',
      })
    ).status,
  ).toBe(403);

  const owner = await login('OWNER');
  expect(
    (
      await overrideRequest(owner, {
        items: [{ date: '2027-01-10', price: 700_000 }],
        priority: 100,
        reason: 'Synthetic HB054',
      })
    ).status,
  ).toBe(200);
  const otherProperty = await overrideRequest(
    owner,
    { items: [{ date: '2027-01-10', price: 700_000 }], priority: 100, reason: 'Synthetic HB054' },
    { roomTypeId: otherTypeId },
  );
  expect(otherProperty.status).toBe(200);

  // OWNER toàn chuỗi không cần dòng phạm vi cơ sở (BR-RBAC-03).
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  expect(
    (
      await overrideRequest(await login('OWNER'), {
        items: [{ date: '2027-01-11', price: 700_000 }],
        priority: 100,
        reason: 'Synthetic HB054',
      })
    ).status,
  ).toBe(200);
});

test('RBAC — thiếu Idempotency-Key là 400; replay cùng khoá không tạo bản ghi thứ hai', async () => {
  const token = await login('OWNER');
  const body = {
    items: [{ date: '2027-01-10', price: 700_000 }],
    priority: 100,
    reason: 'Synthetic HB054',
  };
  expect((await overrideRequest(token, body, { key: null })).status).toBe(400);

  const key = randomUUID();
  const first = await overrideRequest(token, body, { key });
  const replay = await overrideRequest(token, body, { key });
  expect([first.status, replay.status]).toEqual([200, 200]);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(replay.body).toEqual(first.body);
  expect(Number((await rows('SELECT count(*)::int AS n FROM rate_calendars'))[0]!.n)).toBe(1);
  expect(Number((await rows('SELECT count(*)::int AS n FROM outbox_events'))[0]!.n)).toBe(1);
});

test('AC4 — snapshot báo giá đã chốt không đổi khi cấu hình lịch giá thay', async () => {
  const token = await login('OWNER');
  await insertCalendar({ date: '2026-12-24', price: STD.basePrice, source: 'BASE' });
  await insertCalendar({ date: '2026-12-25', price: STD.basePrice, source: 'BASE' });
  const booked = rateCalendarSchema.parse(
    (await calendarRequest(token, typeId, { from: '2026-12-24', to: '2026-12-25' })).body,
  );
  const { snapshotId } = await bookedSnapshot({
    engineVersion: 'hb054-test',
    nights: booked.entries.map((entry) => ({
      date: entry.date,
      source: entry.source,
      nightlyPrice: entry.nightlyPrice,
    })),
  });
  const snapshot = async () =>
    (
      await rows(
        'SELECT payload_json, gross_amount::text AS gross, commission_amount::text AS commission, engine_version, updated_at FROM price_snapshots WHERE id=$1',
        [snapshotId],
      )
    )[0]!;
  const captured = await snapshot();

  const response = await overrideRequest(token, {
    items: [{ date: '2026-12-24', price: 1_000_000 }],
    priority: 100,
    reason: 'Synthetic HB054 snapshot',
    confirmOwnerOverride: true,
  });
  expect(response.status).toBe(200);
  expect(
    rateCalendarSchema.parse(
      (await calendarRequest(token, typeId, { from: '2026-12-24', to: '2026-12-24' })).body,
    ).entries[0],
  ).toMatchObject({ source: 'OVERRIDE', basePrice: 1_000_000, nightlyPrice: 1_000_000 });

  expect(await snapshot()).toEqual(captured);
  expect(Number((await rows('SELECT count(*)::int AS n FROM price_snapshots'))[0]!.n)).toBe(1);
  // BR-RATE-16 vẫn được CSDL bảo vệ: trigger bất biến từ chối mọi UPDATE/DELETE.
  await expect(
    rows('UPDATE price_snapshots SET gross_amount=0 WHERE id=$1', [snapshotId]),
  ).rejects.toThrow(/immutable/);
});
