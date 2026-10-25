import { test } from 'vitest';
import { error, http, login, rows } from './guest-oracle.fixture.js';
import { guestSession, seedGuest } from './guest-data.js';

// HB-017 phần B: ngoài bộ khoá — guard xác thực toàn cục nhận phiên khách nhưng không cấp quyền nhân viên.
const staffRoute = '/api/v1/auth/me';

test('a valid guest session is recognised and denied on staff routes with 403, not 401', async () => {
  await seedGuest();
  const tokens = await login();
  error(
    await http().get(staffRoute).set('Authorization', `Bearer ${tokens.accessToken}`),
    403,
    'E_RBAC_FORBIDDEN',
  );
});
test('a revoked guest session no longer reaches the 403 branch: it is 401', async () => {
  await seedGuest();
  const tokens = await login();
  const session = await guestSession(tokens.refreshToken);
  await rows('UPDATE auth_sessions SET revoked_at = now() WHERE id=$1', [session.id]);
  error(
    await http().get(staffRoute).set('Authorization', `Bearer ${tokens.accessToken}`),
    401,
    'E_AUTH_INVALID_CREDENTIALS',
  );
});
test('a guest access token whose subject is another guest is rejected as 401', async () => {
  await seedGuest();
  const tokens = await login();
  const session = await guestSession(tokens.refreshToken);
  await rows('UPDATE auth_sessions SET guest_id=$2 WHERE id=$1', [
    session.id,
    await seedOtherGuest(),
  ]);
  error(
    await http().get(staffRoute).set('Authorization', `Bearer ${tokens.accessToken}`),
    401,
    'E_AUTH_INVALID_CREDENTIALS',
  );
});
async function seedOtherGuest(): Promise<string> {
  const created = await rows(
    "INSERT INTO guests(full_name, phone) VALUES('Synthetic other guest', '+84900000001') RETURNING id",
  );
  return String(created[0]!.id);
}
