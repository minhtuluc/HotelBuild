/**
 * HB-236 — `GET`/`POST /promotions` trên API thật (UC-RATE-04, SCR-29, BR-RATE-10/11/13).
 * Trước đây chỉ API giả của E2E có tuyến này; hệ thống thật không tạo được khuyến mãi dù engine giá có đọc
 * bảng `promotions`.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  errorBodySchema,
  listResponseSchema,
  promotionSummarySchema,
  quoteSchema,
} from '@pinehill/contracts';
import { http, login, otherPropertyId, propertyId, rows, typeId } from './fixture.js';

const create = (token: string, body: object) =>
  http()
    .post('/api/v1/promotions')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);
const list = (token: string, query: Record<string, string> = {}) =>
  http().get('/api/v1/promotions').set('Authorization', `Bearer ${token}`).query(query);

// SCR-29 gửi `datetime-local` theo giờ VN đổi sang UTC: 01/12 00:00 VN = 30/11 17:00Z.
const body = (code: string, extra: object = {}) => ({
  code,
  type: 'PERCENT',
  value: 10,
  minNights: 2,
  channelScope: ['WEB', 'PHONE'],
  roomTypeScope: ['STD', 'DLX'],
  validFrom: '2026-11-30T17:00:00.000Z',
  validTo: '2026-12-31T16:59:00.000Z',
  maxUses: 100,
  stackable: false,
  ...extra,
});

test('HB236_owner_creates_promotion_stored_as_vn_business_dates_with_audit_and_outbox', async () => {
  const owner = await login('OWNER');
  const created = await create(owner, body('hb236-early'));
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  const [row] = await rows(
    `SELECT id::text AS id, code, name, type, value::text AS value, min_nights, channel_scope,
            room_type_scope, to_char(valid_from,'YYYY-MM-DD') AS valid_from,
            to_char(valid_to,'YYYY-MM-DD') AS valid_to, max_uses, used_count, stackable, status
       FROM promotions WHERE code = 'HB236-EARLY'`,
  );
  expect(row).toMatchObject({
    code: 'HB236-EARLY',
    name: 'HB236-EARLY',
    type: 'PERCENT',
    value: '10.00',
    min_nights: 2,
    channel_scope: ['WEB', 'PHONE'],
    room_type_scope: ['STD', 'DLX'],
    valid_from: '2026-12-01',
    valid_to: '2026-12-31',
    max_uses: 100,
    used_count: 0,
    stackable: false,
    status: 'ACTIVE',
  });
  const id = String(row!.id);
  expect(
    await rows("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='PROMOTION_CREATED'", [id]),
  ).toHaveLength(1);
  expect(
    await rows("SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='RateChanged'", [
      id,
    ]),
  ).toHaveLength(1);

  const read = await list(await login('MANAGER'), { propertyId, status: 'ACTIVE' });
  expect(read.status).toBe(200);
  const promo = listResponseSchema(promotionSummarySchema)
    .parse(read.body)
    .data.find((item) => item.id === id);
  expect(promo).toMatchObject({
    code: 'HB236-EARLY',
    value: 10,
    usedCount: 0,
    validFrom: '2026-11-30T17:00:00.000Z',
    validTo: '2026-12-31T16:59:59.999Z',
  });
});

test('HB236_business_rules_rejected_with_promo_invalid_details', async () => {
  const owner = await login('OWNER');
  const cases: [object, string, string][] = [
    [body('HB236-P', { value: 150 }), 'value', 'MAX_100'],
    [body('HB236-R', { roomTypeScope: ['VIP'] }), 'roomTypeScope', 'UNKNOWN_ROOM_TYPE'],
    [
      body('HB236-W', {
        validFrom: '2026-12-10T00:00:00.000Z',
        validTo: '2026-12-01T00:00:00.000Z',
      }),
      'validTo',
      'BEFORE_START',
    ],
    [body('BAD CODE!'), 'code', 'FORMAT'],
  ];
  for (const [payload, field, issue] of cases) {
    const response = await create(owner, payload);
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    const error = errorBodySchema.parse(response.body);
    expect(error.code).toBe('E_RATE_PROMO_INVALID');
    expect(error.details).toContainEqual({ field, issue });
  }
  expect(await create(owner, body('HB236-DUP'))).toMatchObject({ status: 201 });
  const duplicate = await create(owner, body('hb236-dup'));
  expect(duplicate.status).toBe(422);
  expect(errorBodySchema.parse(duplicate.body).details).toContainEqual({
    field: 'code',
    issue: 'DUPLICATE',
  });
});

test('HB236_roles_and_scope', async () => {
  const manager = await login('MANAGER');
  const denied = await create(manager, body('HB236-MGR'));
  expect(denied.status).toBe(403);
  expect(await rows("SELECT 1 FROM promotions WHERE code='HB236-MGR'")).toHaveLength(0);
  expect((await list(await login('FRONT_DESK'))).status).toBe(403);
  const outside = await list(manager, { propertyId: otherPropertyId });
  expect(outside.status).toBe(403);
});

test('HB236_promotion_created_via_api_is_applied_by_quote_engine', async () => {
  const owner = await login('OWNER');
  const created = await create(
    owner,
    body('HB236-QUOTE', {
      minNights: 1,
      maxUses: undefined,
      // Engine xét cửa sổ khuyến mãi theo **thời điểm đặt** (đồng hồ fixture 09/10/2026), không theo ngày ở.
      validFrom: '2026-09-30T17:00:00.000Z',
    }),
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const quote = (promotionCodes: string[]) =>
    http()
      .post('/api/v1/quotes')
      .set('Idempotency-Key', randomUUID())
      .send({
        propertyId,
        roomTypeId: typeId,
        channelCode: 'WEB',
        ratePlanCode: 'FLEX7',
        checkIn: '2026-12-10',
        checkOut: '2026-12-12',
        adults: 2,
        children: 0,
        roomCount: 1,
        ...(promotionCodes.length > 0 ? { promotionCodes } : {}),
      });
  const plain = await quote([]);
  const discounted = await quote(['HB236-QUOTE']);
  expect(plain.status, JSON.stringify(plain.body)).toBe(201);
  expect(discounted.status, JSON.stringify(discounted.body)).toBe(201);
  const total = (response: { body: unknown }) => quoteSchema.parse(response.body).total;
  // BR-RATE-10: PERCENT 10% áp một lần trên tổng tạm tính.
  expect(total(discounted)).toBeLessThan(total(plain));
});
