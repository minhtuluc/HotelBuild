/**
 * HB-260 — `PATCH /guests/me`: khách tự sửa hồ sơ của mình (SCR-83 "Cập nhật hồ sơ", UC-CRM-01).
 * Chỉ ba trường khách tự quản: họ tên, email, đồng ý nhận khuyến mãi (kèm phiên bản, NFR-COMP-01).
 * SĐT là định danh khách (BR-CRM-01) nên không sửa qua tuyến này.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { errorBodySchema, guestSummarySchema } from '@pinehill/contracts';
import { auditEntries, guestTokenFor, http, login, noBookingId, rows } from './http-fixture.js';

const patch = (body: object, token?: string) => {
  const call = http().patch('/api/v1/guests/me').set('Idempotency-Key', randomUUID());
  return (token === undefined ? call : call.set('Authorization', `Bearer ${token}`)).send(body);
};

describe('HB-260 · PATCH /guests/me', () => {
  test('khách sửa họ tên, email và đồng ý nhận tin; mốc đồng ý do máy chủ ghi', async () => {
    const token = await guestTokenFor(noBookingId);
    const updated = await patch(
      {
        fullName: '  Trần Khách Sửa  ',
        email: 'khach.sua@example.com',
        consentMarketing: true,
        consentVersion: '2026-10',
      },
      token,
    );
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(guestSummarySchema.parse(updated.body)).toMatchObject({
      id: noBookingId,
      fullName: 'Trần Khách Sửa',
      email: 'khach.sua@example.com',
      consentMarketing: true,
    });
    const [row] = await rows(
      'SELECT consent_at IS NOT NULL AS consented, consent_version FROM guests WHERE id=$1',
      [noBookingId],
    );
    expect(row).toEqual({ consented: true, consent_version: '2026-10' });
    // Audit chỉ ghi tên trường đổi — không chép PII (họ tên/email) vào nhật ký.
    const [audit] = await auditEntries('GUEST_PROFILE_UPDATED', noBookingId);
    expect(audit?.after).toContain('fullName');
    expect(audit?.after).not.toContain('khach.sua@example.com');

    const cleared = await patch({ email: null, consentMarketing: false }, token);
    expect(guestSummarySchema.parse(cleared.body)).toMatchObject({
      email: null,
      consentMarketing: false,
    });
  });

  test('không sửa được SĐT/trường lạ; đồng ý nhận tin phải kèm phiên bản; thân rỗng ⇒ 400', async () => {
    const token = await guestTokenFor(noBookingId);
    for (const body of [
      { phone: '+84911111111' },
      { loyaltyPoints: 9999 },
      { consentMarketing: true },
      { email: 'không-phải-email' },
      {},
    ]) {
      const refused = await patch(body, token);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(errorBodySchema.parse(refused.body).code).toBe('E_GEN_VALIDATION_FAILED');
    }
  });

  test('phiên nhân viên ⇒ 403; không token ⇒ 401', async () => {
    expect((await patch({ fullName: 'X' }, await login('OWNER'))).status).toBe(403);
    expect((await patch({ fullName: 'X' })).status).toBe(401);
  });
});
