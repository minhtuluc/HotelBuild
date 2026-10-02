import { expect, it } from 'vitest';
import { createAuthApi } from '../src/auth.js';
import { ApiClient } from '../src/client.js';

const unauthorized = (): Response =>
  new Response(
    JSON.stringify({
      code: 'E_AUTH_INVALID_CREDENTIALS',
      message: 'Phiên đã hết hạn.',
      traceId: 'trace-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      path: '/api/v1/x',
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );

it('access token và refresh token cùng hết hạn: hook gọi logout không làm request treo', async () => {
  let accessToken: string | null = 'access-token-da-het-han-0001';
  const client: ApiClient = new ApiClient({
    baseUrl: 'http://api.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000001',
    getAccessToken: () => accessToken,
    fetchImpl: async () => unauthorized(),
    sleep: async () => undefined,
    // Mẫu của hai app Android: refresh thất bại → logout trên máy chủ (cũng 401) → xoá phiên.
    onUnauthorized: async () => {
      try {
        await auth.refresh('refresh-token-da-het-han-0001');
        return true;
      } catch {
        await auth.logout().catch(() => undefined);
        accessToken = null;
        return false;
      }
    },
  });
  const auth = createAuthApi(client);

  const outcome = await Promise.race([
    auth.changePassword({ currentPassword: 'cu-12345678', newPassword: 'moi-12345678' }).then(
      () => 'resolved',
      () => 'rejected',
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve('treo'), 1000)),
  ]);
  expect(outcome).toBe('rejected');
});
