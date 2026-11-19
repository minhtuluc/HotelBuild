import { describe, expect, test } from 'vitest';
import { errorBodySchema, guestLoyaltySchema, guestSummarySchema } from '@pinehill/contracts';
import { admin, guests, guestTokenFor, http, login, loyaltyId } from './http-fixture.js';

// HB-250: `GET /guests/me` và `/guests/me/loyalty` có trong hợp đồng (api.md §2.10, HB-105) nhưng API chưa cài.
// Trên máy thật, app khách gọi `/guests/me` rơi vào tuyến nhân viên `/guests/:guestId` và nhận 403.
const me = (path: '' | '/loyalty', token?: string) => {
  const call = http().get(`/api/v1/guests/me${path}`);
  return token === undefined ? call : call.set('Authorization', `Bearer ${token}`);
};

describe('HB-250 · GET /guests/me', () => {
  test('phiên khách đọc đúng hồ sơ của chính mình, không lưu đệm', async () => {
    const response = await me('', await guestTokenFor(loyaltyId));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(guestSummarySchema.parse(response.body)).toMatchObject({
      id: loyaltyId,
      phone: guests.loyaltyPhone,
      loyaltyTier: 'SILVER',
      loyaltyPoints: 120,
    });
  });

  test('phiên nhân viên không có "hồ sơ khách của tôi" → 403, không rơi vào tuyến theo id', async () => {
    const response = await me('', await login('OWNER'));
    expect(response.status).toBe(403);
    expect(errorBodySchema.parse(response.body).code).toBe('E_RBAC_FORBIDDEN');
  });

  test('không có token → 401', async () => {
    expect((await me('')).status).toBe(401);
  });
});

describe('HB-250 · GET /guests/me/loyalty', () => {
  test('khách đọc hạng/điểm/số đêm của mình, trùng số liệu tuyến quản trị theo id', async () => {
    const response = await me('/loyalty', await guestTokenFor(loyaltyId));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const own = guestLoyaltySchema.parse(response.body);
    const staff = guestLoyaltySchema.parse(
      (await admin.loyalty(await login('OWNER'), loyaltyId)).body,
    );
    expect(own).toEqual(staff);
    expect(own.guestId).toBe(loyaltyId);
  });

  test('phiên nhân viên → 403; không token → 401', async () => {
    expect((await me('/loyalty', await login('FRONT_DESK'))).status).toBe(403);
    expect((await me('/loyalty')).status).toBe(401);
  });
});
