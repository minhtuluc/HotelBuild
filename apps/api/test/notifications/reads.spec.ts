import { describe, expect, test } from 'vitest';
import {
  errorBodySchema,
  listResponseSchema,
  notificationSummarySchema,
} from '@pinehill/contracts';
import {
  http,
  login,
  rows,
  listNotifications,
  seedNotification,
  bookingId,
  otherBookingId,
  userId,
} from './fixture.js';

/**
 * HB-168 · GET /notifications (UC-NOTI-01): danh sách che PII do **máy chủ**, lọc theo
 * `notificationQuerySchema`, phân trang `listResponseSchema`, RBAC + phạm vi cơ sở qua booking.
 */
const pageSchema = listResponseSchema(notificationSummarySchema);

describe('HB-168 · GET /notifications che PII', () => {
  test('SĐT giữ 4 số cuối, email dạng a***@domain; không lộ nội dung thô', async () => {
    await seedNotification({ recipient: '+84912345678', channel: 'SMS' });
    await seedNotification({
      recipient: 'nguyen.van.a@example.com',
      channel: 'EMAIL',
    });
    const token = await login('FRONT_DESK');
    const response = await listNotifications(token);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = pageSchema.parse(response.body);
    const masked = new Map(body.data.map((row) => [row.channel, row.recipientMasked]));
    expect(masked.get('SMS')).toBe('****5678');
    expect(masked.get('EMAIL')).toBe('n***@example.com');
    for (const row of body.data) expect(row.recipientMasked.length).toBeGreaterThan(0);
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('+84912345678');
    expect(raw).not.toContain('nguyen.van.a@example.com');
  });
});

describe('HB-168 · GET /notifications lọc + phân trang', () => {
  test('lọc theo bookingId/channel/status/template/from/to và q trên mẫu thư', async () => {
    const first = await seedNotification({
      recipient: '+84911111111',
      channel: 'SMS',
      template: 'booking-confirmed',
    });
    const second = await seedNotification({
      recipient: 'khang@example.com',
      channel: 'EMAIL',
      template: 'refund-paid',
      status: 'FAILED',
      retryCount: 3,
      errorMessage: 'Kênh gửi thất bại.',
    });
    const token = await login('FRONT_DESK');
    expect(
      pageSchema.parse((await listNotifications(token, { bookingId })).body).data,
    ).toHaveLength(2);
    expect(
      pageSchema
        .parse((await listNotifications(token, { channel: 'EMAIL' })).body)
        .data.map((row) => row.id),
    ).toEqual([second]);
    expect(
      pageSchema
        .parse((await listNotifications(token, { status: 'FAILED' })).body)
        .data.map((row) => row.id),
    ).toEqual([second]);
    expect(
      pageSchema
        .parse((await listNotifications(token, { template: 'refund-paid' })).body)
        .data.map((row) => row.id),
    ).toEqual([second]);
    const byBooking = pageSchema
      .parse((await listNotifications(token, { bookingId })).body)
      .data.map((row) => row.id);
    expect([...byBooking].sort()).toEqual([first, second].sort());
    expect(
      pageSchema
        .parse((await listNotifications(token, { q: 'refund' })).body)
        .data.map((row) => row.id),
    ).toEqual([second]);
    const stamp = new Date().toISOString();
    expect(
      pageSchema.parse((await listNotifications(token, { from: stamp })).body).data,
    ).toHaveLength(0);
    expect(
      pageSchema.parse((await listNotifications(token, { to: '2020-01-01T00:00:00Z' })).body).data,
    ).toHaveLength(0);
  });

  test('phân trang limit/cursor, meta.total chính xác', async () => {
    await seedNotification({ recipient: '+84911111111' });
    await seedNotification({ recipient: '+84922222222' });
    await seedNotification({ recipient: '+84933333333' });
    const token = await login('FRONT_DESK');
    const first = pageSchema.parse((await listNotifications(token, { limit: '2' })).body);
    expect(first.data).toHaveLength(2);
    expect(first.meta).toMatchObject({ limit: 2, hasMore: true, total: 3 });
    expect(first.meta.nextCursor).not.toBeNull();
    const second = pageSchema.parse(
      (await listNotifications(token, { limit: '2', cursor: first.meta.nextCursor! })).body,
    );
    expect(second.data).toHaveLength(1);
    expect(second.meta).toMatchObject({ hasMore: false, nextCursor: null, total: 3 });
    expect(
      new Set([...first.data.map((row) => row.id), ...second.data.map((row) => row.id)]).size,
    ).toBe(3);
  });

  test('tham số sai: limit vượt trần, bookingId xấu, from ≥ to ⇒ 400 E_GEN_VALIDATION_FAILED', async () => {
    const token = await login('FRONT_DESK');
    const bad: Record<string, string>[] = [
      { limit: '101' },
      { bookingId: 'not-a-uuid' },
      { from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' },
      { channel: 'CARRIER_PIGEON' },
      {},
    ];
    for (const [index, query] of bad.entries()) {
      const response =
        index === 4 ? await listNotifications(token) : await listNotifications(token, query);
      if (index === 4) {
        expect(response.status).toBe(200);
        continue;
      }
      expect(response.status, JSON.stringify(query)).toBe(400);
      expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_VALIDATION_FAILED');
    }
  });
});

describe('HB-168 · GET /notifications RBAC + phạm vi', () => {
  test('vai trò không phép ⇒ 403 E_RBAC_FORBIDDEN; bốn vai trò vận hành ⇒ 200', async () => {
    await seedNotification();
    for (const role of ['ACCOUNTANT', 'HOUSEKEEPING', 'SYSADMIN'] as const) {
      const token = await login(role);
      const response = await listNotifications(token);
      expect(response.status, role).toBe(403);
      expect(errorBodySchema.parse(response.body).code).toBe('E_RBAC_FORBIDDEN');
    }
    for (const role of ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'] as const) {
      const token = await login(role);
      expect((await listNotifications(token)).status, role).toBe(200);
    }
  });

  test('nhân viên chỉ thấy bản ghi gắn booking trong phạm vi; OWNER thấy tất cả', async () => {
    await seedNotification();
    const outer = await seedNotification({ bookingId: otherBookingId });
    const token = await login('FRONT_DESK');
    const rows = pageSchema.parse((await listNotifications(token)).body).data;
    expect(rows.map((row) => row.id)).toHaveLength(1);
    expect(rows[0]!.bookingId).toBe(bookingId);
    expect(rows.some((row) => row.id === outer)).toBe(false);
    const filtered = await listNotifications(token, { bookingId: otherBookingId });
    expect(filtered.status).toBe(403);
    expect(errorBodySchema.parse(filtered.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
    const owner = await login('OWNER');
    expect(pageSchema.parse((await listNotifications(owner)).body).data).toHaveLength(2);
  });

  test('bản ghi không gắn booking chỉ OWNER thấy', async () => {
    const orphan = await seedNotification({ bookingId: null });
    const token = await login('FRONT_DESK');
    expect(
      pageSchema.parse((await listNotifications(token)).body).data.some((row) => row.id === orphan),
    ).toBe(false);
    const owner = await login('OWNER');
    expect(
      pageSchema.parse((await listNotifications(owner)).body).data.some((row) => row.id === orphan),
    ).toBe(true);
  });

  test('chưa đăng nhập ⇒ 401', async () => {
    const response = await http().get('/api/v1/notifications');
    expect(response.status).toBe(401);
  });
});

describe('HB-168 · GET /notifications dữ kiện hiển thị', () => {
  test('retryCount/errorMessage/sentAt phản ánh đúng hàng CSDL', async () => {
    await seedNotification({
      recipient: 'a@example.com',
      channel: 'EMAIL',
      status: 'SENT',
      sentAt: new Date('2026-11-02T03:04:05Z'),
      retryCount: 1,
    });
    const token = await login('FRONT_DESK');
    const body = pageSchema.parse((await listNotifications(token)).body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      bookingId,
      channel: 'EMAIL',
      template: 'booking-confirmed',
      status: 'SENT',
      recipientMasked: 'a***@example.com',
      retryCount: 1,
      errorMessage: null,
      sentAt: '2026-11-02T03:04:05.000Z',
    });
    expect(
      (await rows('SELECT actor_id FROM audit_logs WHERE entity_type=$1', ['Notification'])).length,
    ).toBe(0);
    expect(userId.length).toBeGreaterThan(0);
  });
});
