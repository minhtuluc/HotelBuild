import { test, expect } from 'vitest';
import { errorBodySchema, userMeSchema } from '@pinehill/contracts';
import {
  roles,
  matrix,
  login,
  http,
  mutations,
  rows,
  userId,
  otherPropertyId,
  roomId,
  otherRoomId,
  propertyId,
} from './fixture.js';

for (const role of roles) {
  for (const [operation, allowed] of Object.entries(matrix)) {
    test(`${role} × ${operation} obeys the published explicit role set`, async () => {
      const token = await login(role);
      const result = await http()
        .post(`/api/v1/rbac/${operation}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'OWNER', propertyScope: [otherPropertyId] });
      expect(result.status).toBe(allowed.includes(role) ? 201 : 403);
      expect(mutations).toHaveLength(allowed.includes(role) ? 1 : 0);
      if (!allowed.includes(role))
        expect(errorBodySchema.parse(result.body).code).toBe('E_RBAC_FORBIDDEN');
    });
  }
}

test('role changes in the DB override an older signed JWT role before permission checking', async () => {
  const token = await login('OWNER');
  await rows("UPDATE users SET role='HOUSEKEEPING' WHERE id=$1::uuid", [userId]);
  const result = await http()
    .post('/api/v1/rbac/rate.configure')
    .set('Authorization', `Bearer ${token}`)
    .send({ role: 'OWNER' });
  expect(result.status).toBe(403);
  expect(mutations).toHaveLength(0);
});
test('authentication runs before permission checking', async () => {
  const result = await http().post('/api/v1/rbac/refund.pay');
  expect(result.status).toBe(401);
  expect(errorBodySchema.parse(result.body).code).toBe('E_AUTH_INVALID_CREDENTIALS');
  expect(mutations).toHaveLength(0);
});

test('a scoped employee can read the permitted resource through all five representative endpoints', async () => {
  const token = await login();
  for (const path of ['bookings', 'payments', 'refunds', 'holds', 'exports']) {
    const result = await http()
      .get(`/api/v1/rbac/${path}/${roomId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: roomId, propertyId });
  }
});
test('IDOR to another property is denied on all five representative endpoints', async () => {
  const token = await login();
  for (const path of ['bookings', 'payments', 'refunds', 'holds', 'exports']) {
    const result = await http()
      .get(`/api/v1/rbac/${path}/${otherRoomId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(result.status).toBe(403);
    expect(errorBodySchema.parse(result.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
    expect(JSON.stringify(result.body)).not.toContain(otherPropertyId);
  }
});
test('OWNER chain scope allows other properties without granting a financial write permission', async () => {
  const token = await login('OWNER');
  expect(
    (
      await http()
        .get(`/api/v1/rbac/bookings/${otherRoomId}`)
        .set('Authorization', `Bearer ${token}`)
    ).status,
  ).toBe(200);
  expect(
    (await http().post('/api/v1/rbac/refund.pay').set('Authorization', `Bearer ${token}`)).status,
  ).toBe(403);
});

for (const role of roles)
  test(`${role} can use the published auth.me permission`, async () => {
    const token = await login(role);
    const result = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(result.status).toBe(200);
    expect(userMeSchema.parse(result.body).role).toBe(role);
  });
test('a current DB scope change takes effect without trusting old token scopes', async () => {
  const token = await login();
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [userId]);
  const result = await http()
    .get(`/api/v1/rbac/bookings/${roomId}`)
    .set('Authorization', `Bearer ${token}`);
  expect(result.status).toBe(403);
  expect(errorBodySchema.parse(result.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
});
