import { test, expect } from 'vitest';
import { normalizeResponse } from '../../src/common/idempotency/response.js';
test('rejects media types and headers that would fail or transform HTTP after commit', () => {
  for (const headers of [
    { 'content-type': 'text/plain' },
    { location: '/result\ninvalid' },
    { etag: '"emoji-😀"' },
    { 'content-encoding': 'gzip' },
    { 'content-length': '999' },
    { 'transfer-encoding': 'chunked' },
  ])
    expect(() => normalizeResponse(201, { ok: true }, headers)).toThrow();
});
test('keeps JSON/status/Location/ETag and strips request-specific trace headers', () => {
  const body = { created: 1 };
  const result = normalizeResponse(201, body, {
    location: '/result/1',
    etag: '"2"',
    'x-trace-id': 'old-trace',
  });
  body.created = 9;
  expect(result).toEqual({
    status: 201,
    body: { created: 1 },
    headers: { location: '/result/1', etag: '"2"' },
  });
});
for (const body of [
  { refreshToken: 'must-not-cache' },
  { data: { password: 'must-not-cache' } },
  { access_token: 'must-not-cache' },
  { pinToken: 'must-not-cache' },
])
  test('rejects credential-bearing JSON before business transaction commits', () => {
    expect(() => normalizeResponse(200, body, {})).toThrow();
  });
test('rejects Set-Cookie and malformed status/body rather than persisting unsafe response', () => {
  expect(() => normalizeResponse(200, {}, { 'set-cookie': 'private-cookie' })).toThrow();
  expect(() => normalizeResponse(99, {}, {})).toThrow();
  expect(() => normalizeResponse(200, { bad: 1n }, {})).toThrow();
  expect(normalizeResponse(204, undefined, {})).toEqual({ status: 204, body: null, headers: {} });
});
