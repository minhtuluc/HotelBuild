import { expect, test } from 'vitest';
import { ApiClient } from '../src/client.js';

// TD-20: sai `currentPassword` cũng trả 401 `E_AUTH_INVALID_CREDENTIALS` và được máy chủ đếm vào ngưỡng
// khoá. Nếu client coi đó là token hết hạn rồi làm mới + gửi lại thì mỗi lần sai bị đếm hai lần.
const CASES = [
  {
    method: 'POST',
    path: '/auth/password',
    body: { currentPassword: 'sai', newPassword: 'moi-12345' },
  },
  { method: 'PUT', path: '/auth/pin', body: { pin: '123456', currentPassword: 'sai' } },
] as const;

test.each(CASES)(
  '401 của $method $path không kích hoạt làm mới phiên và không gửi lại',
  async (spec) => {
    let calls = 0;
    let hooks = 0;
    const client = new ApiClient({
      baseUrl: 'https://api.test/api/v1',
      getAccessToken: () => 'synthetic-access-token-0001',
      onUnauthorized: async () => {
        hooks++;
        return true;
      },
      fetchImpl: async () => {
        calls++;
        return Response.json(
          {
            code: 'E_AUTH_INVALID_CREDENTIALS',
            message: 'Sai thông tin',
            traceId: 'synthetic',
            timestamp: '2026-11-10T00:00:00.000Z',
            path: `/api/v1${spec.path}`,
          },
          { status: 401 },
        );
      },
    });
    await expect(client.requestVoid(spec)).rejects.toMatchObject({ status: 401 });
    expect(hooks).toBe(0);
    expect(calls).toBe(1);
  },
);
