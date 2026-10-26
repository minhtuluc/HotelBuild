/**
 * HB-213 — `GET /refund-requests`: bộ lọc (status/bookingId/propertyId), phân trang con trỏ tất định,
 * ma trận quyền api.md §6.3, phạm vi cơ sở áp trong truy vấn và hình dạng `ListPage<RefundRequest>`.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test } from 'vitest';
import { listResponseSchema, refundRequestSchema } from '@pinehill/contracts';
import type { RefundRequest } from '@pinehill/contracts';
import {
  booking,
  clock,
  errorCode,
  flexPolicy,
  http,
  login,
  propertyId,
  secondUserId,
  unallocatedPayment,
} from './fixture.js';
import { otherPropertyId, rows } from '../room-blocks/inventory-seed.js';

const million = 1_000_000;
const MAKER = 'h029-first';
const SECOND = 'h029-second';
const guestRequest = { reason: 'GUEST_REQUEST', isForceMajeure: false };
const pageSchema = listResponseSchema(refundRequestSchema);

/** Bậc duy nhất ở mốc ≥7 ngày quyết định `refundPercent` của mọi hồ sơ trong tệp này. */
async function setTier(percent: number): Promise<void> {
  const policy = String(
    (await rows("SELECT cancellation_policy_id AS id FROM rate_plans WHERE code='FLEX7'"))[0]!.id,
  );
  await rows(
    'UPDATE cancellation_tiers SET refund_percent=$2 WHERE policy_id=$1::uuid AND offset_hours=168',
    [policy, percent],
  );
}

beforeEach(async () => {
  await flexPolicy();
  await setTier(100);
});

/** Booking CONFIRMED + chứng từ **chưa phân bổ** vào nghĩa vụ: đủ quỹ để giữ hạn mức hoàn. */
async function source(amount = 2 * million) {
  const created = await booking({ status: 'CONFIRMED', price: amount, nights: 3 });
  const paymentId = await unallocatedPayment(created.id, BigInt(amount));
  return { bookingId: created.id, paymentId };
}

const openRefund = (token: string, body: object) =>
  http()
    .post('/api/v1/refund-requests')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);

const withdraw = (token: string, id: string) =>
  http()
    .post(`/api/v1/refund-requests/${id}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', randomUUID())
    .send({ reason: 'Khách đổi ý' });

const list = (token: string, query = '') =>
  http().get(`/api/v1/refund-requests${query}`).set('Authorization', `Bearer ${token}`);

/** Lập một hồ sơ PENDING qua API thật và trả về view đúng hợp đồng + booking nguồn. */
async function pending(token: string): Promise<{ view: RefundRequest; bookingId: string }> {
  const { bookingId, paymentId } = await source();
  const response = await openRefund(token, { bookingId, paymentId, ...guestRequest });
  expect(response.status).toBe(201);
  return { view: refundRequestSchema.parse(response.body), bookingId };
}

test('lọc status/bookingId/propertyId, trả đúng ListPage<RefundRequest> và `no-store`', async () => {
  const maker = await login(MAKER, 'FRONT_DESK');
  const first = await pending(maker);
  const second = await pending(maker);
  expect((await withdraw(maker, second.view.id)).status).toBe(200);
  const auditsBefore = (await rows('SELECT count(*) AS n FROM audit_logs'))[0]!.n;

  const all = await list(maker);
  expect(all.status).toBe(200);
  expect(all.headers['cache-control']).toBe('no-store');
  const page = pageSchema.parse(all.body);
  expect(page.meta).toEqual({ limit: 20, hasMore: false, nextCursor: null, total: 2 });
  expect(page.data.map((row) => row.id).sort()).toEqual([first.view.id, second.view.id].sort());
  // Chỉ trường của hợp đồng đã phát hành: không `pinToken`, không số tài khoản thô, không ghi chú.
  const allowed = new Set(Object.keys(refundRequestSchema.shape));
  for (const row of page.data) {
    expect(Object.keys(row).filter((key) => !allowed.has(key))).toEqual([]);
    expect(row).not.toHaveProperty('pinToken');
    expect(row).not.toHaveProperty('bankAccount');
    expect(row).not.toHaveProperty('note');
  }

  const pendingPage = pageSchema.parse((await list(maker, '?status=PENDING')).body);
  expect(pendingPage.data.map((row) => row.id)).toEqual([first.view.id]);
  const cancelled = pageSchema.parse((await list(maker, '?status=CANCELLED')).body);
  expect(cancelled.data.map((row) => row.id)).toEqual([second.view.id]);
  const byBooking = pageSchema.parse((await list(maker, `?bookingId=${first.bookingId}`)).body);
  expect(byBooking.data.map((row) => row.id)).toEqual([first.view.id]);
  const byProperty = pageSchema.parse((await list(maker, `?propertyId=${propertyId}`)).body);
  expect(byProperty.meta).toEqual({ limit: 20, hasMore: false, nextCursor: null, total: 2 });
  // Đọc không ghi: danh sách không sinh bản ghi audit.
  expect((await rows('SELECT count(*) AS n FROM audit_logs'))[0]!.n).toBe(auditsBefore);
});

test('cursor tất định theo (created_at,id) và chỉ hợp lệ trong đúng bộ lọc', async () => {
  const maker = await login(MAKER, 'FRONT_DESK');
  const created = [await pending(maker), await pending(maker), await pending(maker)];
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let index = 0; index < 3; index += 1) {
    const query = `?limit=1${cursor === null ? '' : `&cursor=${cursor}`}`;
    const page = pageSchema.parse((await list(maker, query)).body);
    expect(page.data).toHaveLength(1);
    expect(page.meta.hasMore).toBe(index < 2);
    expect(page.meta.limit).toBe(1);
    seen.push(page.data[0]!.id);
    cursor = page.meta.nextCursor;
  }
  expect(cursor).toBeNull();
  expect(new Set(seen).size).toBe(3);
  expect([...seen].sort()).toEqual(created.map((row) => row.view.id).sort());
  // Lặp lại cùng truy vấn phải cho cùng trang, không trùng/không nhảy bản ghi.
  const first = pageSchema.parse((await list(maker, '?limit=2')).body);
  const again = pageSchema.parse((await list(maker, '?limit=2')).body);
  expect(again.data.map((row) => row.id)).toEqual(first.data.map((row) => row.id));
  expect(first.meta.hasMore).toBe(true);

  // Cursor của bộ lọc khác (booking khác) bị từ chối thay vì trả trang sai.
  const foreign = pageSchema.parse(
    (await list(maker, `?limit=1&bookingId=${created[1]!.bookingId}`)).body,
  );
  expect(foreign.data).toHaveLength(1);
  const mismatch = await list(
    maker,
    `?cursor=${foreign.data[0]!.id}&bookingId=${created[0]!.bookingId}`,
  );
  expect(mismatch.status).toBe(400);
  expect(errorCode(mismatch.body)).toBe('E_GEN_VALIDATION_FAILED');
  expect((await list(maker, '?cursor=not-a-uuid')).status).toBe(400);
  expect((await list(maker, '?limit=101')).status).toBe(400);
  expect((await list(maker, '?status=UNKNOWN')).status).toBe(400);
});

test('quyền §6.3: năm vai trò đọc được; HOUSEKEEPING và SYSADMIN bị 403', async () => {
  const maker = await login(MAKER, 'FRONT_DESK');
  const created = await pending(maker);
  const allowed = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER', 'ACCOUNTANT'];
  for (const role of [...allowed, 'HOUSEKEEPING', 'SYSADMIN']) {
    clock.value += 61_000;
    const token = await login(SECOND, role);
    const response = await list(token);
    if (allowed.includes(role)) {
      expect(response.status, role).toBe(200);
      expect(pageSchema.parse(response.body).data.map((row) => row.id)).toContain(created.view.id);
    } else {
      expect(response.status, role).toBe(403);
      expect(errorCode(response.body), role).toBe('E_RBAC_FORBIDDEN');
    }
  }
});

test('phạm vi cơ sở lọc trong truy vấn; propertyId ngoài phạm vi là 403', async () => {
  const maker = await login(MAKER, 'FRONT_DESK');
  await pending(maker);
  const scoped = await login(SECOND, 'FRONT_DESK');
  expect(pageSchema.parse((await list(scoped)).body).meta.total).toBe(1);
  const denied = await list(scoped, `?propertyId=${otherPropertyId}`);
  expect(denied.status).toBe(403);
  expect(errorCode(denied.body)).toBe('E_AUTH_OUT_OF_SCOPE');
  // Chuyển phạm vi sang cơ sở khác: hồ sơ cơ sở A biến mất khỏi danh sách (lọc ở truy vấn).
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [secondUserId]);
  await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid)', [
    secondUserId,
    otherPropertyId,
  ]);
  try {
    const outside = pageSchema.parse((await list(scoped)).body);
    expect(outside.data).toEqual([]);
    expect(outside.meta.total).toBe(0);
  } finally {
    await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid AND property_id=$2::uuid', [
      secondUserId,
      otherPropertyId,
    ]);
    await rows(
      'INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid) ON CONFLICT DO NOTHING',
      [secondUserId, propertyId],
    );
  }
  // OWNER đọc toàn chuỗi nhưng `propertyId` vẫn là bộ lọc, không phải nguồn cấp quyền.
  const owner = await login(MAKER, 'OWNER');
  const other = pageSchema.parse((await list(owner, `?propertyId=${otherPropertyId}`)).body);
  expect(other.data).toEqual([]);
  expect(pageSchema.parse((await list(owner)).body).meta.total).toBe(1);
});
