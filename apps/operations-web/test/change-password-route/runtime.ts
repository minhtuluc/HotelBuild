import { createServer } from 'node:http';
import { ApiClient } from '@pinehill/api-client';
import { changePassword } from '../../src/session/api';
import { POST } from '../../src/app/api/session/sys/auth/change-password/route';
delete process.env.SESSION_APP_ORIGIN;
const seen: { method: string; path: string }[] = [];
const server = createServer((req, res) => {
  seen.push({ method: req.method ?? '', path: req.url ?? '' });
  req.resume();
  req.on('end', () => {
    res.writeHead(204);
    res.end();
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
try {
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('TCP');
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:' + address.port + '/api/v1';
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    req.headers.set('origin', 'https://ops.test');
    return POST(req);
  };
  const client = new ApiClient({
    baseUrl: 'https://ops.test/api/session/sys',
    getAccessToken: () => 'synthetic-access',
    fetchImpl,
    maxAttempts: 1,
  });
  await changePassword(client, { currentPassword: 'Old-Pass-1234', newPassword: 'New-Pass-5678' });
  process.stdout.write(JSON.stringify(seen));
} finally {
  server.close();
}
