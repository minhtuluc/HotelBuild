import { randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, test } from 'vitest';
import { errorBodySchema, guestLoyaltySchema, guestSummarySchema } from '@pinehill/contracts';
import { GuestsController } from '../../src/modules/crm/guests/controller.js';
import {
  admin,
  anonymizeId,
  auditEntries,
  auditTotal,
  blacklistId,
  blockedId,
  guestById,
  guestProfile,
  guests,
  http,
  login,
  loyaltyId,
  noBookingId,
  outsideId,
  rows,
} from './http-fixture.js';

/** Lý do chứa SĐT để khẳng định văn bản tự do được che trước khi vào nhật ký (NFR-SEC-03). */
// Lý do tự do thật ở quầy hay nhắc tên khách: nhật ký phải không còn tên gốc lẫn SĐT chưa che (NFR-COMP-01).
const ANONYMIZE_REASON = `Ẩn danh theo yêu cầu của ${guestProfile.fullName} (báo qua +84900000201)`;

const REQUESTED_AT = '2026-10-01T02:00:00Z';

/** Thu hẹp thành viên prototype của controller thành hàm handler (type guard để `Reflect.getMetadata` nhận `object`). */
function isEndpointHandler(value: unknown): value is object {
  return typeof value === 'function';
}

describe('HB-166 · ẩn danh hoá hồ sơ khách', () => {
  test('thay PII theo danh mục, giữ booking/thanh toán, idempotent và nhật ký không chứa PII', async () => {
    const token = await login('MANAGER');
    const bookingsBefore = await rows('SELECT count(*) AS n FROM bookings WHERE guest_id=$1', [
      anonymizeId,
    ]);
    const paymentsBefore = await rows(
      'SELECT count(*) AS n FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.guest_id=$1',
      [anonymizeId],
    );
    const auditBefore = await auditTotal('GUEST_ANONYMIZED');

    const response = await admin.anonymize(token, anonymizeId, {
      reason: ANONYMIZE_REASON,
      requestedAt: REQUESTED_AT,
    });
    expect(response.status).toBe(200);
    expect(guestSummarySchema.parse(response.body)).toMatchObject({
      id: anonymizeId,
      fullName: 'Khách đã ẩn danh',
      phone: '+84000000000',
      email: null,
      blacklisted: true,
    });

    const after = await guestById(anonymizeId);
    expect(after).toMatchObject({
      full_name: 'Khách đã ẩn danh',
      phone: '+84000000000',
      email: null,
      id_number: null,
      dob: null,
      nationality: null,
      gender: 'UNSPECIFIED',
      notes: null,
      blacklist_reason: 'Hồ sơ đã ẩn danh hoá',
      blacklisted: true,
    });
    expect(after.anonymized_at).not.toBeNull();
    const flat = JSON.stringify(after);
    for (const secret of [
      guestProfile.fullName,
      guests.anonymizePhone,
      guestProfile.email,
      guestProfile.idNumber,
      guestProfile.notes,
      guestProfile.blacklistReason,
    ])
      expect(flat, secret).not.toContain(secret);

    expect(await rows('SELECT content FROM guest_notes WHERE guest_id=$1', [anonymizeId])).toEqual([
      { content: '[Ẩn danh hoá]' },
    ]);
    expect(
      await rows('SELECT reason FROM loyalty_transactions WHERE guest_id=$1', [anonymizeId]),
    ).toEqual([{ reason: null }]);
    // Booking và thanh toán giữ nguyên để đối soát (BR-CRM-05, NFR-COMP-02).
    expect(Number(bookingsBefore[0]!.n)).toBe(2);
    expect(Number(paymentsBefore[0]!.n)).toBe(1);
    expect(
      await rows('SELECT count(*) AS n FROM bookings WHERE guest_id=$1', [anonymizeId]),
    ).toEqual(bookingsBefore);
    expect(
      await rows(
        'SELECT count(*) AS n FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.guest_id=$1',
        [anonymizeId],
      ),
    ).toEqual(paymentsBefore);

    const entries = await auditEntries('GUEST_ANONYMIZED', anonymizeId);
    expect(entries).toHaveLength(1);
    const log = JSON.stringify(entries[0]);
    for (const secret of [
      guestProfile.fullName,
      guests.anonymizePhone,
      guestProfile.email,
      guestProfile.idNumber,
      guestProfile.notes,
      guestProfile.blacklistReason,
    ])
      expect(log, secret).not.toContain(secret);
    expect(log).toContain('****');
    expect(String(entries[0]!.reason)).toContain('****0201');
    expect(String(entries[0]!.reason)).not.toContain(guests.anonymizePhone);
    // Tên khách vừa bị xoá khỏi hồ sơ cũng không được nằm lại trong lý do tự do của nhật ký.
    expect(String(entries[0]!.reason)).not.toContain(guestProfile.fullName);
    expect(String(entries[0]!.reason)).toContain('Khách đã ẩn danh');
    expect(String(entries[0]!.reason)).toContain('Ẩn danh theo yêu cầu của');
    // Yêu cầu chủ thể dữ liệu được lưu vết: mốc khách báo + mốc máy chủ ẩn danh hoá (NFR-COMP-01).
    expect(String(entries[0]!.after)).toContain(REQUESTED_AT);
    expect(String(entries[0]!.after)).toContain('anonymizedAt');

    // Idempotent: lượt hai không đổi cột nào (kể cả `updated_at`) và không thêm nhật ký.
    const snapshot = JSON.stringify(await guestById(anonymizeId));
    const second = await admin.anonymize(token, anonymizeId, {
      reason: ANONYMIZE_REASON,
      requestedAt: REQUESTED_AT,
    });
    expect(second.status).toBe(200);
    expect(JSON.stringify(await guestById(anonymizeId))).toBe(snapshot);
    expect(await auditTotal('GUEST_ANONYMIZED')).toBe(auditBefore + 1);
    expect(await auditEntries('GUEST_ANONYMIZED', anonymizeId)).toHaveLength(1);
  });

  test('thân yêu cầu sai trả 400, hồ sơ không tồn tại trả 404', async () => {
    const token = await login('MANAGER');
    const bodies = [
      { requestedAt: REQUESTED_AT },
      { reason: 'Thiếu mốc yêu cầu' },
      { reason: 'Mốc sai định dạng', requestedAt: 'không-phải-thời-điểm' },
      { reason: 'Có trường lạ', requestedAt: REQUESTED_AT, extra: 1 },
    ];
    for (const body of bodies) {
      const response = await admin.anonymize(token, anonymizeId, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_VALIDATION_FAILED');
    }
    const badId = await admin.anonymize(token, 'không-phải-uuid', {
      reason: 'Khách yêu cầu',
      requestedAt: REQUESTED_AT,
    });
    expect(badId.status).toBe(400);
    const unknown = await admin.anonymize(token, randomUUID(), {
      reason: 'Khách yêu cầu',
      requestedAt: REQUESTED_AT,
    });
    expect(unknown.status).toBe(404);
    expect(errorBodySchema.parse(unknown.body).code).toBe('E_GEN_NOT_FOUND');
  });
});

describe('HB-166 · hạng và điểm (loyalty)', () => {
  test('trả hạng/điểm/số đêm 12 tháng chỉ tính booking đã ở thực tế', async () => {
    const token = await login('FRONT_DESK');
    const response = await admin.loyalty(token, loyaltyId);
    expect(response.status).toBe(200);
    const loyalty = guestLoyaltySchema.parse(response.body);
    expect(loyalty).toMatchObject({
      guestId: loyaltyId,
      loyaltyTier: 'SILVER',
      loyaltyPoints: 120,
      staysLast12Months: 5,
      totalStays: 9,
    });
    expect(loyalty.updatedAt).toBe((await guestById(loyaltyId)).updated_at.toISOString());
  });

  test('hồ sơ chưa có booking trả 0 đêm, 0 điểm', async () => {
    const token = await login('RESERVATION_AGENT');
    const response = await admin.loyalty(token, noBookingId);
    expect(response.status).toBe(200);
    expect(guestLoyaltySchema.parse(response.body)).toMatchObject({
      guestId: noBookingId,
      loyaltyTier: 'GUEST',
      loyaltyPoints: 0,
      staysLast12Months: 0,
      totalStays: 0,
    });
  });
});

describe('HB-166 · danh sách đen', () => {
  test('thêm khách vào danh sách đen cần lý do, có nhật ký, lặp lại không thêm bản ghi', async () => {
    const token = await login('MANAGER');
    expect((await admin.addBlacklist(token, blacklistId, {})).status).toBe(400);
    expect((await admin.addBlacklist(token, blacklistId, { blacklistReason: '' })).status).toBe(
      400,
    );
    const auditBefore = await auditTotal('GUEST_BLACKLISTED');

    const added = await admin.addBlacklist(token, blacklistId, {
      blacklistReason: 'Khách gây ồn +84900000204',
    });
    expect(added.status).toBe(201);
    expect(guestSummarySchema.parse(added.body)).toMatchObject({
      id: blacklistId,
      blacklisted: true,
    });
    expect((await guestById(blacklistId)).blacklist_reason).toBe('Khách gây ồn ****0204');

    const entries = await auditEntries('GUEST_BLACKLISTED', blacklistId);
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0])).not.toContain(guests.blacklistPhone);
    expect(String(entries[0]!.reason)).toContain('****0204');

    const again = await admin.addBlacklist(token, blacklistId, {
      blacklistReason: 'Khách gây ồn +84900000204',
    });
    expect(again.status).toBe(201);
    expect(await auditTotal('GUEST_BLACKLISTED')).toBe(auditBefore + 1);
  });

  test('gỡ khỏi danh sách đen cần lý do, trả 204 và ghi nhật ký một lần', async () => {
    const token = await login('MANAGER');
    expect((await admin.releaseBlacklist(token, blockedId, {})).status).toBe(400);
    expect((await admin.releaseBlacklist(token, blockedId, { reason: '' })).status).toBe(400);
    const auditBefore = await auditTotal('GUEST_BLACKLIST_RELEASED');

    const released = await admin.releaseBlacklist(token, blockedId, { reason: 'Khách đã xin lỗi' });
    expect(released.status).toBe(204);
    expect(released.text).toBe('');
    expect(await guestById(blockedId)).toMatchObject({
      blacklisted: false,
      blacklist_reason: null,
    });
    const entries = await auditEntries('GUEST_BLACKLIST_RELEASED', blockedId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reason).toBe('Khách đã xin lỗi');

    expect((await admin.releaseBlacklist(token, blockedId, { reason: 'Gỡ lần hai' })).status).toBe(
      204,
    );
    expect(await auditTotal('GUEST_BLACKLIST_RELEASED')).toBe(auditBefore + 1);
  });

  test('gỡ khỏi danh sách đen chỉ MANAGER/OWNER', async () => {
    for (const role of [
      'FRONT_DESK',
      'RESERVATION_AGENT',
      'HOUSEKEEPING',
      'ACCOUNTANT',
      'SYSADMIN',
    ]) {
      const token = await login(role);
      const response = await admin.releaseBlacklist(token, blockedId, { reason: 'Thử quyền' });
      expect(response.status, role).toBe(403);
      expect(errorBodySchema.parse(response.body).code).toBe('E_RBAC_FORBIDDEN');
    }
    expect(await guestById(blockedId)).toMatchObject({ blacklisted: true });
    const owner = await login('OWNER');
    expect((await admin.releaseBlacklist(owner, blockedId, { reason: 'OWNER gỡ' })).status).toBe(
      204,
    );
  });
});

describe('HB-166 · quyền và phạm vi cơ sở', () => {
  test('ẩn danh hoá và blacklist chỉ MANAGER/OWNER', async () => {
    for (const role of [
      'FRONT_DESK',
      'RESERVATION_AGENT',
      'HOUSEKEEPING',
      'ACCOUNTANT',
      'SYSADMIN',
    ]) {
      const token = await login(role);
      const calls = [
        admin.anonymize(token, anonymizeId, { reason: 'Khách yêu cầu', requestedAt: REQUESTED_AT }),
        admin.addBlacklist(token, blacklistId, { blacklistReason: 'Thử quyền' }),
      ];
      for (const pending of calls) {
        const response = await pending;
        expect(response.status, role).toBe(403);
        expect(errorBodySchema.parse(response.body).code).toBe('E_RBAC_FORBIDDEN');
      }
    }
    // Ca bị cấm không đổi dữ liệu.
    expect(await guestById(anonymizeId)).toMatchObject({ anonymized_at: null, blacklisted: true });
    expect(await guestById(blacklistId)).toMatchObject({ blacklisted: false });
  });

  test('loyalty cho quầy/điều phối trở lên, vai trò khác 403', async () => {
    for (const role of ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER']) {
      const token = await login(role);
      expect((await admin.loyalty(token, loyaltyId)).status, role).toBe(200);
    }
    for (const role of ['HOUSEKEEPING', 'ACCOUNTANT', 'SYSADMIN']) {
      const token = await login(role);
      const response = await admin.loyalty(token, loyaltyId);
      expect(response.status, role).toBe(403);
      expect(errorBodySchema.parse(response.body).code).toBe('E_RBAC_FORBIDDEN');
    }
  });

  test('hồ sơ chỉ thuộc cơ sở ngoài phạm vi trả 403 E_AUTH_OUT_OF_SCOPE', async () => {
    const manager = await login('MANAGER');
    const denied = await admin.anonymize(manager, outsideId, {
      reason: 'Khách yêu cầu',
      requestedAt: REQUESTED_AT,
    });
    expect(denied.status).toBe(403);
    expect(errorBodySchema.parse(denied.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
    const loyaltyDenied = await admin.loyalty(manager, outsideId);
    expect(loyaltyDenied.status).toBe(403);
    expect(errorBodySchema.parse(loyaltyDenied.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
    const blacklistDenied = await admin.addBlacklist(manager, outsideId, {
      blacklistReason: 'Ngoài phạm vi',
    });
    expect(blacklistDenied.status).toBe(403);
    expect(await guestById(outsideId)).toMatchObject({ blacklisted: false, anonymized_at: null });

    // OWNER có phạm vi chuỗi nên đọc được hồ sơ của cơ sở khác; hồ sơ lạ vẫn 404.
    const owner = await login('OWNER');
    expect((await admin.loyalty(owner, outsideId)).status).toBe(200);
    expect((await admin.loyalty(owner, randomUUID())).status).toBe(404);
  });
});

describe('HB-166 · ràng buộc âm (§2.14)', () => {
  test('không có tuyến xoá hồ sơ khách, chỉ có tuyến gỡ danh sách đen', async () => {
    const deletePaths = Object.getOwnPropertyNames(GuestsController.prototype)
      .map((name): unknown => Reflect.get(GuestsController.prototype, name))
      .filter(isEndpointHandler)
      .filter((handler) => Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.DELETE)
      .map((handler) => String(Reflect.getMetadata(PATH_METADATA, handler)));
    expect(deletePaths).toEqual([':guestId/blacklist']);

    const token = await login('MANAGER');
    const response = await http()
      .delete(`/api/v1/guests/${blacklistId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID());
    expect(response.status).toBe(404);
    expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_NOT_FOUND');
  });
});
