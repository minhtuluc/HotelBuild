/**
 * HB-240 (TD-08) — `PUT /promotions/{promotionId}`: sửa hoặc ngừng khuyến mãi trên API thật.
 * Trước đây SCR-29 chỉ tạo được, không tắt sớm được một mã đang chạy.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  errorBodySchema,
  listResponseSchema,
  promotionSummarySchema,
  quoteSchema,
} from '@pinehill/contracts';
import { http, login, propertyId, rows, typeId } from './fixture.js';

const base = (code: string, extra: object = {}) => ({
  code,
  type: 'PERCENT',
  value: 10,
  minNights: 1,
  channelScope: ['WEB'],
  roomTypeScope: [],
  // Engine xét cửa sổ theo thời điểm đặt (đồng hồ fixture 09/10/2026).
  validFrom: '2026-09-30T17:00:00.000Z',
  validTo: '2026-12-31T16:59:00.000Z',
  stackable: false,
  ...extra,
});

async function created(code: string, extra: object = {}) {
  const owner = await login('OWNER');
  const response = await http()
    .post('/api/v1/promotions')
    .set('Authorization', `Bearer ${owner}`)
    .set('Idempotency-Key', randomUUID())
    .send(base(code, extra));
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const listed = await http()
    .get('/api/v1/promotions')
    .set('Authorization', `Bearer ${owner}`)
    .query({ limit: '100' });
  const promo = listResponseSchema(promotionSummarySchema)
    .parse(listed.body)
    .data.find((item) => item.code === code);
  expect(promo).toBeDefined();
  return { owner, promo: promo! };
}

const update = (token: string, id: string, body: object, version?: number) => {
  const call = http()
    .put(`/api/v1/promotions/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID());
  return (version === undefined ? call : call.set('If-Match', `"${version}"`)).send(body);
};

const quote = (promotionCodes: string[]) =>
  http().post('/api/v1/quotes').set('Idempotency-Key', randomUUID()).send({
    propertyId,
    roomTypeId: typeId,
    channelCode: 'WEB',
    ratePlanCode: 'FLEX7',
    checkIn: '2026-12-10',
    checkOut: '2026-12-12',
    adults: 2,
    children: 0,
    roomCount: 1,
    promotionCodes,
  });

test('HB240_owner_deactivates_promotion_quote_engine_stops_applying_it', async () => {
  const { owner, promo } = await created('HB240-OFF');
  const total = (response: { body: unknown }) => quoteSchema.parse(response.body).total;
  const plain = total(await quote([]));
  expect(total(await quote(['HB240-OFF']))).toBeLessThan(plain);

  const off = await update(
    owner,
    promo.id,
    { status: 'INACTIVE', reason: 'Hết ngân sách' },
    promo.version,
  );
  expect(off.status, JSON.stringify(off.body)).toBe(204);

  const [row] = await rows('SELECT status, version::int AS version FROM promotions WHERE id=$1', [
    promo.id,
  ]);
  expect(row).toMatchObject({ status: 'INACTIVE', version: promo.version + 1 });
  const audit = await rows(
    "SELECT reason, before_json->>'status' AS before, after_json->>'status' AS after FROM audit_logs WHERE entity_id=$1 AND action='PROMOTION_INACTIVE'",
    [promo.id],
  );
  expect(audit).toEqual([{ reason: 'Hết ngân sách', before: 'ACTIVE', after: 'INACTIVE' }]);
  expect(
    await rows("SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='RateChanged'", [
      promo.id,
    ]),
  ).toHaveLength(2);
  // Loader chỉ nạp mã `ACTIVE`; mã đã ngừng vẫn có trong danh mục nên không lỗi, chỉ **không giảm**.
  const after = await quote(['HB240-OFF']);
  expect(after.status, JSON.stringify(after.body)).toBe(201);
  expect(total(after)).toBe(plain);
});

test('HB240_partial_update_rechecks_rules_on_merged_promotion', async () => {
  const { owner, promo } = await created('HB240-EDIT');
  const changed = await update(
    owner,
    promo.id,
    { value: 20, roomTypeScope: ['dlx'], validTo: '2027-01-15T10:00:00.000Z', reason: 'Gia hạn' },
    promo.version,
  );
  expect(changed.status, JSON.stringify(changed.body)).toBe(204);
  const [row] = await rows(
    `SELECT value::text AS value, room_type_scope, to_char(valid_from,'YYYY-MM-DD') AS valid_from,
            to_char(valid_to,'YYYY-MM-DD') AS valid_to, code, type FROM promotions WHERE id=$1`,
    [promo.id],
  );
  expect(row).toMatchObject({
    value: '20.00',
    room_type_scope: ['DLX'],
    valid_from: '2026-10-01',
    valid_to: '2027-01-15',
    code: 'HB240-EDIT',
    type: 'PERCENT',
  });
  expect(
    await rows("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='PROMOTION_UPDATED'", [
      promo.id,
    ]),
  ).toHaveLength(1);

  const next = promo.version + 1;
  const cases: [object, string, string][] = [
    [{ value: 150, reason: 'x' }, 'value', 'MAX_100'],
    // Chỉ dời `validTo` vẫn phải ≥ `validFrom` đang lưu (01/10/2026).
    [{ validTo: '2026-09-01T00:00:00.000Z', reason: 'x' }, 'validTo', 'BEFORE_START'],
    [{ roomTypeScope: ['VIP'], reason: 'x' }, 'roomTypeScope', 'UNKNOWN_ROOM_TYPE'],
  ];
  for (const [body, field, issue] of cases) {
    const response = await update(owner, promo.id, body, next);
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(errorBodySchema.parse(response.body).details).toContainEqual({ field, issue });
  }
  const [unchanged] = await rows('SELECT value::text AS value FROM promotions WHERE id=$1', [
    promo.id,
  ]);
  expect(unchanged).toMatchObject({ value: '20.00' });
});

test('HB240_max_uses_cannot_drop_below_used_count', async () => {
  const { owner, promo } = await created('HB240-USES', { maxUses: 10 });
  await rows('UPDATE promotions SET used_count = 5 WHERE id=$1', [promo.id]);
  const [current] = await rows('SELECT version::int AS version FROM promotions WHERE id=$1', [
    promo.id,
  ]);
  const below = await update(
    owner,
    promo.id,
    { maxUses: 3, reason: 'Giảm lượt' },
    Number(current?.version),
  );
  expect(below.status).toBe(422);
  expect(errorBodySchema.parse(below.body).details).toContainEqual({
    field: 'maxUses',
    issue: 'BELOW_USED',
  });
  const unlimited = await update(
    owner,
    promo.id,
    { maxUses: null, reason: 'Bỏ giới hạn' },
    Number(current?.version),
  );
  expect(unlimited.status, JSON.stringify(unlimited.body)).toBe(204);
  expect(await rows('SELECT max_uses FROM promotions WHERE id=$1', [promo.id])).toEqual([
    { max_uses: null },
  ]);
});

test('HB240_version_role_and_body_guards', async () => {
  const { owner, promo } = await created('HB240-GUARD');
  const missingVersion = await update(owner, promo.id, { status: 'INACTIVE', reason: 'x' });
  expect(missingVersion.status).toBe(428);
  const stale = await update(
    owner,
    promo.id,
    { status: 'INACTIVE', reason: 'x' },
    promo.version + 7,
  );
  expect(stale.status).toBe(412);
  expect(errorBodySchema.parse(stale.body).code).toBe('E_GEN_VERSION_CONFLICT');
  // `code`/`type` không sửa được; thân chỉ có `reason` cũng bị từ chối.
  for (const body of [
    { code: 'NEW', reason: 'x' },
    { type: 'AMOUNT', reason: 'x' },
    { reason: 'x' },
  ])
    expect((await update(owner, promo.id, body, promo.version)).status).toBe(400);
  const unknown = await update(owner, randomUUID(), { status: 'INACTIVE', reason: 'x' }, 1);
  expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
  // Fixture dùng chung một user: `login('MANAGER')` hạ vai trò của chính user đó ⇒ gọi cuối.
  const manager = await update(
    await login('MANAGER'),
    promo.id,
    { status: 'INACTIVE', reason: 'x' },
    promo.version,
  );
  expect(manager.status).toBe(403);
  const [row] = await rows('SELECT status FROM promotions WHERE id=$1', [promo.id]);
  expect(row).toMatchObject({ status: 'ACTIVE' });
  // Báo giá vẫn áp mã còn hiệu lực sau các lần từ chối.
  expect(quoteSchema.parse((await quote(['HB240-GUARD'])).body).total).toBeGreaterThan(0);
});
