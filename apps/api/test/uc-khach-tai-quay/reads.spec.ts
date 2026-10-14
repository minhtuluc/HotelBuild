import { describe, expect, test } from 'vitest';
import { errorBodySchema, guestSummarySchema, listResponseSchema } from '@pinehill/contracts';
import { assertGuestNotBlacklisted } from '../../src/modules/crm/guests/blacklist.js';
import {
  createGuest,
  db,
  guests,
  listGuests,
  login,
  otherId,
  propertyId,
  otherPropertyId,
  rows,
  scopedId,
  blacklistedId,
  noBookingId,
} from './http-fixture.js';

const guestListSchema = listResponseSchema(guestSummarySchema);

const PROFILE = {
  fullName: 'Khách Mới Tại Quầy',
  email: 'khach.moi@example.com',
  consentMarketing: true,
  consentVersion: '2026-01',
};

describe('HB-149 · POST /guests', () => {
  test('SĐT nội địa 0… được chuẩn hoá thành +84… và hồ sơ không gắn tài khoản khách', async () => {
    const token = await login('FRONT_DESK');
    const response = await createGuest(token, { ...PROFILE, phone: '0900000199' });
    expect(response.status).toBe(201);
    const summary = guestSummarySchema.parse(response.body);
    expect(summary).toMatchObject({
      fullName: PROFILE.fullName,
      phone: '+84900000199',
      email: PROFILE.email,
      blacklisted: false,
      loyaltyTier: 'GUEST',
      loyaltyPoints: 0,
      totalStays: 0,
      consentMarketing: true,
    });
    expect(
      await rows('SELECT guest_id FROM guest_credentials WHERE guest_id=$1', [summary.id]),
    ).toEqual([]);
  });

  test('trùng SĐT (kể cả dạng có dấu cách) trả hồ sơ có sẵn, không tạo bản thứ hai', async () => {
    const token = await login('FRONT_DESK');
    const first = guestSummarySchema.parse(
      (await createGuest(token, { ...PROFILE, phone: '+84900000198' })).body,
    );
    const second = await createGuest(token, { ...PROFILE, phone: '+84 900 000 198' });
    expect(second.status).toBe(200);
    expect(guestSummarySchema.parse(second.body).id).toBe(first.id);
    expect(await rows('SELECT id FROM guests WHERE phone=$1', ['+84900000198'])).toHaveLength(1);
  });

  test('trùng SĐT của khách ngoài phạm vi bị từ chối, không lộ hồ sơ', async () => {
    const token = await login('FRONT_DESK');
    const outside = await createGuest(token, { ...PROFILE, phone: guests.otherPhone });
    expect(outside.status).toBe(403);
    expect(errorBodySchema.parse(outside.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
    // Khách trong phạm vi (có booking ở cơ sở A) và hồ sơ chưa phát sinh booking vẫn trả bình thường.
    const inside = await createGuest(token, { ...PROFILE, phone: guests.scopedPhone });
    expect(inside.status).toBe(200);
    expect(guestSummarySchema.parse(inside.body).id).toBe(scopedId);
    const counter = await createGuest(token, { ...PROFILE, phone: guests.noBookingPhone });
    expect(counter.status).toBe(200);
    expect(guestSummarySchema.parse(counter.body).id).toBe(noBookingId);
  });

  test('SĐT sai mẫu trả 422 E_CRM_PHONE_INVALID', async () => {
    const token = await login('FRONT_DESK');
    for (const phone of ['12345', '090000019', '+8512345678', 'abc']) {
      const response = await createGuest(token, { ...PROFILE, phone });
      expect(response.status, phone).toBe(422);
      expect(errorBodySchema.parse(response.body).code).toBe('E_CRM_PHONE_INVALID');
    }
  });

  test('thiếu trường bắt buộc trả 400', async () => {
    const token = await login('FRONT_DESK');
    const response = await createGuest(token, { phone: '+84900000197' });
    expect(response.status).toBe(400);
    expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_VALIDATION_FAILED');
  });

  test('ghi audit cho hồ sơ tạo mới, có che PII', async () => {
    const token = await login('FRONT_DESK');
    const created = guestSummarySchema.parse(
      (await createGuest(token, { ...PROFILE, phone: '0900000196' })).body,
    );
    const entries = await rows(
      "SELECT after_json::text AS after FROM audit_logs WHERE action='GUEST_CREATED' AND entity_id=$1",
      [created.id],
    );
    expect(entries).toHaveLength(1);
    const after = String(entries[0]!.after);
    expect(after).toContain('****0196');
    expect(after).not.toContain('+84900000196');
  });
});

describe('HB-149 · GET /guests', () => {
  test('tìm theo tên chỉ trong phạm vi cơ sở; khách chưa có booking không lộ cho nhân viên', async () => {
    const token = await login('FRONT_DESK');
    const body = guestListSchema.parse((await listGuests(token, { q: 'Khách' })).body);
    const ids = body.data.map((guest) => guest.id);
    expect(ids).toContain(scopedId);
    expect(ids).toContain(blacklistedId);
    expect(ids).not.toContain(otherId);
    expect(ids).not.toContain(noBookingId);
  });

  test('OWNER có phạm vi chuỗi thấy cả khách của cơ sở khác', async () => {
    const token = await login('OWNER');
    const body = guestListSchema.parse((await listGuests(token, { q: 'Khách' })).body);
    expect(body.data.map((guest) => guest.id).sort()).toEqual(
      [scopedId, otherId, noBookingId, blacklistedId].sort(),
    );
  });

  test('lọc theo danh sách đen và giới hạn trang đúng hợp đồng', async () => {
    const token = await login('MANAGER');
    const body = guestListSchema.parse(
      (await listGuests(token, { blacklisted: 'true', limit: '1' })).body,
    );
    expect(body.data.map((guest) => guest.id)).toEqual([blacklistedId]);
    expect(body.meta).toMatchObject({ limit: 1, hasMore: false, nextCursor: null, total: 1 });
  });

  test('lọc theo cơ sở ngoài phạm vi trả 403 E_AUTH_OUT_OF_SCOPE', async () => {
    const token = await login('MANAGER');
    const response = await listGuests(token, { propertyId: otherPropertyId });
    expect(response.status).toBe(403);
    expect(errorBodySchema.parse(response.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
  });

  test('MANAGER lọc theo cơ sở trong phạm vi chỉ trả khách của cơ sở đó', async () => {
    const token = await login('MANAGER');
    const body = guestListSchema.parse((await listGuests(token, { propertyId })).body);
    expect(body.data.map((guest) => guest.id).sort()).toEqual([scopedId, blacklistedId].sort());
  });
});

describe('HB-149 · quyền và danh sách đen', () => {
  test('chỉ vai trò quầy/điều phối được đọc và tạo hồ sơ khách', async () => {
    for (const role of ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER']) {
      const token = await login(role);
      expect((await listGuests(token)).status, role).toBe(200);
    }
    for (const role of ['HOUSEKEEPING', 'ACCOUNTANT', 'SYSADMIN']) {
      const token = await login(role);
      const read = await listGuests(token);
      expect(read.status, role).toBe(403);
      expect(errorBodySchema.parse(read.body).code).toBe('E_RBAC_FORBIDDEN');
      const write = await createGuest(token, { ...PROFILE, phone: '+84900000195' });
      expect(write.status, role).toBe(403);
    }
  });

  test('khách trong danh sách đen bị chặn bởi guard dùng chung (BR-CRM-04)', async () => {
    await expect(
      db.$transaction((tx) => assertGuestNotBlacklisted(tx, blacklistedId)),
    ).rejects.toMatchObject({ code: 'E_BOOK_BLACKLISTED', status: 403 });
    await expect(
      db.$transaction((tx) => assertGuestNotBlacklisted(tx, scopedId)),
    ).resolves.toBeUndefined();
  });
});
