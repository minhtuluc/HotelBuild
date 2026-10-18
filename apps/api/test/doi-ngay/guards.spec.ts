/**
 * HB-098 — cổng chặn biên của hai lệnh đổi ngày / xoá cứng (api.md §2.5, §6.3; BR-RBAC-02):
 * tập vai trò tường minh, phiên hợp lệ, phạm vi cơ sở và bất biến khai báo quyền.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { userRoleSchema } from '@pinehill/contracts';
import { reschedulePermissionRules } from '../../src/modules/book/reschedule/permissions.js';
import {
  createBooking,
  deleteRequest,
  errorCode,
  http,
  login,
  rescheduleRequest,
  rows,
  shifted,
  userId,
  versionOf,
} from './fixture.js';

describe('HB-098 cổng chặn quyền', () => {
  test('§6.3: FRONT_DESK trở lên qua cổng; HOUSEKEEPING/ACCOUNTANT/SYSADMIN ⇒ 403; thiếu Bearer ⇒ 401', async () => {
    const { booking } = await createBooking({}, { token: await login() });
    const body = { checkIn: shifted.checkIn, checkOut: shifted.checkOut };

    for (const role of ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER']) {
      const token = await login(role);
      // Neo sai ⇒ lệnh đi hết chuỗi kiểm nghiệp vụ rồi mới dừng ở `412` (đúng vai trò).
      const reached = await rescheduleRequest(token, booking.id, body, { tag: '9' });
      expect(reached.status, role).toBe(412);
      expect(errorCode(reached.body)).toBe('E_GEN_VERSION_CONFLICT');
    }

    for (const role of ['HOUSEKEEPING', 'ACCOUNTANT', 'SYSADMIN']) {
      const token = await login(role);
      const denied = await rescheduleRequest(token, booking.id, body, { tag: '9' });
      expect(denied.status, role).toBe(403);
      expect(errorCode(denied.body)).toBe('E_RBAC_FORBIDDEN');
      const remove = await deleteRequest(token, booking.id, { reason: 'Thử quyền' });
      expect(remove.status, role).toBe(403);
      expect(errorCode(remove.body)).toBe('E_RBAC_FORBIDDEN');
    }

    const anonymous = await http()
      .post(`/api/v1/bookings/${booking.id}/reschedule`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
    expect(anonymous.status).toBe(401);
    const anonymousDelete = await http()
      .delete(`/api/v1/bookings/${booking.id}`)
      .query({ reason: 'Ẩn danh' })
      .set('Idempotency-Key', randomUUID());
    expect(anonymousDelete.status).toBe(401);
    // Không lệnh nào chạm dữ liệu.
    expect(
      await rows('SELECT reschedule_count FROM bookings WHERE id=$1::uuid', [booking.id]),
    ).toEqual([{ reschedule_count: 0 }]);
  });

  test('BR-RBAC-02: booking ngoài phạm vi cơ sở ⇒ 403 E_AUTH_OUT_OF_SCOPE; OWNER không cần hàng scope', async () => {
    const token = await login();
    const { booking } = await createBooking({}, { token });
    await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [userId]);

    const denied = await rescheduleRequest(
      token,
      booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut },
      { tag: '9' },
    );
    expect(denied.status).toBe(403);
    expect(errorCode(denied.body)).toBe('E_AUTH_OUT_OF_SCOPE');
    const remove = await deleteRequest(token, booking.id, { reason: 'Thử phạm vi' });
    expect(remove.status).toBe(403);
    expect(errorCode(remove.body)).toBe('E_AUTH_OUT_OF_SCOPE');

    const owner = await login('OWNER');
    const accepted = await rescheduleRequest(
      owner,
      booking.id,
      { checkIn: shifted.checkIn, checkOut: shifted.checkOut },
      { tag: await versionOf(owner, booking.id) },
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  });

  test('bất biến khai báo quyền: chỉ vai trò người dùng hợp lệ, không khai GUEST trước HB-017', () => {
    const declared = Object.values(reschedulePermissionRules).flat();
    expect(declared.length).toBeGreaterThan(0);
    for (const role of declared) expect(userRoleSchema.safeParse(role).success).toBe(true);
    // `PermissionRegistry` từ chối vai trò ngoài `userRoleSchema` ngay khi khởi động ⇒ khai `GUEST` sẽ
    // làm sập ứng dụng; đường khách đổi ngày của chính mình thuộc phiên khách (HB-017).
    expect(userRoleSchema.safeParse('GUEST').success).toBe(false);
    expect(declared).not.toContain('GUEST');
    expect([...new Set(declared)].sort()).toEqual([
      'FRONT_DESK',
      'MANAGER',
      'OWNER',
      'RESERVATION_AGENT',
    ]);
  });
});
