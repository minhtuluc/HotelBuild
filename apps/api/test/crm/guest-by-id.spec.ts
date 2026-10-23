import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { errorBodySchema, guestSummarySchema, listResponseSchema } from '@pinehill/contracts';
import {
  admin,
  anonymizeId,
  guests,
  http,
  login,
  loyaltyId,
  noBookingId,
  outsideId,
} from './http-fixture.js';

const getGuest = (token: string, id: string) =>
  http().get(`/api/v1/guests/${id}`).set('Authorization', `Bearer ${token}`);

describe('HB-208 · GET /guests/{guestId}', () => {
  test('khách có booking trong phạm vi: đúng projection của danh sách, không lưu đệm', async () => {
    const token = await login('FRONT_DESK');
    const response = await getGuest(token, loyaltyId);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const guest = guestSummarySchema.parse(response.body);
    expect(guest).toMatchObject({
      id: loyaltyId,
      phone: guests.loyaltyPhone,
      loyaltyTier: 'SILVER',
      loyaltyPoints: 120,
      blacklisted: false,
    });
    const listed = await http()
      .get('/api/v1/guests')
      .query({ q: guests.loyaltyPhone })
      .set('Authorization', `Bearer ${token}`);
    const page = listResponseSchema(guestSummarySchema).parse(listed.body);
    expect(page.data.find((row) => row.id === loyaltyId)).toEqual(guest);
  });

  test.each(['RESERVATION_AGENT', 'MANAGER', 'OWNER'])(
    '%s đọc được khách trong phạm vi',
    async (role) => {
      const token = await login(role);
      expect((await getGuest(token, loyaltyId)).status).toBe(200);
    },
  );

  test('khách chỉ thuộc cơ sở ngoài phạm vi và mã không tồn tại cho cùng một câu trả lời 404', async () => {
    const token = await login('FRONT_DESK');
    const outside = await getGuest(token, outsideId);
    const unknown = await getGuest(token, randomUUID());
    expect(outside.status).toBe(404);
    expect(unknown.status).toBe(404);
    const a = errorBodySchema.parse(outside.body);
    const b = errorBodySchema.parse(unknown.body);
    expect(a.code).toBe('E_GEN_NOT_FOUND');
    expect(a.code).toBe(b.code);
    expect(a.message).toBe(b.message);
    expect(JSON.stringify(outside.body)).not.toContain(guests.outsidePhone);
  });

  test('OWNER đọc được khách ở mọi cơ sở', async () => {
    const token = await login('OWNER');
    const response = await getGuest(token, outsideId);
    expect(response.status).toBe(200);
    expect(guestSummarySchema.parse(response.body).id).toBe(outsideId);
  });

  test('hồ sơ chưa có booking vẫn đọc lại được như các tuyến theo id khác của module', async () => {
    const token = await login('FRONT_DESK');
    const response = await getGuest(token, noBookingId);
    expect(response.status).toBe(200);
    expect(guestSummarySchema.parse(response.body).id).toBe(noBookingId);
  });

  test.each(['HOUSEKEEPING', 'ACCOUNTANT', 'SYSADMIN'])('%s bị 403', async (role) => {
    const token = await login(role);
    const response = await getGuest(token, loyaltyId);
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain(guests.loyaltyPhone);
  });

  test('mã không phải UUID ⇒ 400; thiếu token ⇒ 401', async () => {
    const token = await login('FRONT_DESK');
    expect((await getGuest(token, 'khong-phai-uuid')).status).toBe(400);
    expect((await http().get(`/api/v1/guests/${loyaltyId}`)).status).toBe(401);
  });

  test('hồ sơ đã ẩn danh hoá trả đúng bản ẩn danh, không còn PII', async () => {
    const manager = await login('MANAGER');
    const done = await admin.anonymize(manager, anonymizeId, {
      reason: 'Khách yêu cầu ẩn danh theo chính sách',
      requestedAt: '2026-10-01T02:00:00Z',
    });
    expect(done.status).toBe(200);
    const response = await getGuest(manager, anonymizeId);
    expect(response.status).toBe(200);
    const guest = guestSummarySchema.parse(response.body);
    expect(guest).toMatchObject({
      fullName: 'Khách đã ẩn danh',
      phone: '+84000000000',
      email: null,
    });
    expect(JSON.stringify(response.body)).not.toContain(guests.anonymizePhone);
  });
});
