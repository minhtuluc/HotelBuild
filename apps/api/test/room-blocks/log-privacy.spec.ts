import { expect, test } from 'vitest';
import pino from 'pino';
import { requestPath, serializeSafeRequest } from '../../src/common/safe-request.js';
test('actual Pino serializer omits query values and credentials while retaining operation and request ID', () => {
  let output = '';
  const logger = pino(
    { serializers: { req: serializeSafeRequest } },
    {
      write: (chunk) => {
        output += chunk;
      },
    },
  );
  logger.info(
    {
      req: {
        id: 'synthetic-id',
        method: 'DELETE',
        url: '/api/v1/room-blocks/synthetic?reason=CCCD012345678934',
        headers: { authorization: 'Bearer synthetic-credential' },
      },
    },
    'request completed',
  );
  const record: unknown = JSON.parse(output);
  expect(record).toMatchObject({
    req: { method: 'DELETE', url: '/api/v1/room-blocks/synthetic', id: 'synthetic-id' },
  });
  expect(output).not.toContain('012345678934');
  expect(output).not.toContain('synthetic-credential');
});
test('error/log path projection strips queries without changing the source URL used for request hashing', () => {
  const url = '/api/v1/room-blocks/synthetic?reason=synthetic.guest%40example.test';
  expect(requestPath(url)).toBe('/api/v1/room-blocks/synthetic');
  expect(url).toContain('reason=');
});
