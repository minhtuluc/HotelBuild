import { test, expect } from 'vitest';
import { identifyRequest } from '../../src/common/idempotency/request.js';
const principal = { type: 'USER', id: '00000000-0000-4000-8000-000000000001' } as const;
const key = '00000000-0000-4000-8000-000000000029';
const input = {
  method: 'POST',
  url: '/commands/a',
  headers: { 'idempotency-key': key },
  body: { a: 1, b: 2 },
};
test('missing request body and explicit JSON null have different identities', () => {
  expect(identifyRequest(principal, { ...input, body: undefined }).requestHash).not.toBe(
    identifyRequest(principal, { ...input, body: null }).requestHash,
  );
});
test('canonical object order and ignored auth/trace headers keep the same payload identity', () => {
  const first = identifyRequest(principal, input);
  const second = identifyRequest(principal, {
    ...input,
    body: { b: 2, a: 1 },
    headers: {
      ...input.headers,
      authorization: 'secret-must-not-be-stored',
      'x-correlation-id': 'another-trace',
    },
  });
  expect(first.requestHash).toBe(second.requestHash);
  expect(first).toMatchObject({ principal, method: 'POST', path: '/commands/a', key });
  expect(JSON.stringify(first)).not.toContain('secret-must-not-be-stored');
});
for (const changed of [
  { body: { a: 2, b: 2 } },
  { body: [2, 1] },
  { url: '/commands/b' },
  { headers: { ...input.headers, 'if-match': '"7"' } },
  { url: '/commands/a?mode=force' },
])
  test(`different body/resource/precondition/query changes hash: ${JSON.stringify(changed)}`, () => {
    expect(identifyRequest(principal, { ...input, ...changed }).requestHash).not.toBe(
      identifyRequest(principal, input).requestHash,
    );
  });
test('array order is preserved and query parameter ordering is canonical', () => {
  expect(identifyRequest(principal, { ...input, body: [1, 2] }).requestHash).not.toBe(
    identifyRequest(principal, { ...input, body: [2, 1] }).requestHash,
  );
  expect(identifyRequest(principal, { ...input, url: '/commands/a?b=2&a=1' }).requestHash).toBe(
    identifyRequest(principal, { ...input, url: '/commands/a?a=1&b=2' }).requestHash,
  );
});
test('normalizes UUID resource spelling, escaped path and trailing slash without dropping the ID', () => {
  const result = identifyRequest(principal, {
    ...input,
    url: '/commands/%61BCDEF01-2345-4000-8000-000000000029/',
  });
  expect(result.path).toBe('/commands/abcdef01-2345-4000-8000-000000000029');
});
for (const bad of ['', 'not-uuid', '00000000-0000-7000-8000-000000000029', `${key},${key}`])
  test(`rejects invalid or non-v4 idempotency key: ${bad}`, () => {
    let error: unknown;
    try {
      identifyRequest(principal, { ...input, headers: { 'idempotency-key': bad } });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ status: 400, code: 'E_GEN_VALIDATION_FAILED' });
  });
test('UUID key casing denotes the same key', () => {
  const spelling = 'abcdef01-2345-4000-8000-000000000029';
  expect(
    identifyRequest(principal, { ...input, headers: { 'idempotency-key': spelling.toUpperCase() } })
      .key,
  ).toBe(spelling);
});
test('ambiguous URL characters cannot alias a different routed resource', () => {
  for (const url of [
    '/commands/a#hidden',
    '/commands\\a',
    '/commands/../a',
    '/commands/%2e%2e/a',
    '/commands/\na',
  ])
    expect(() => identifyRequest(principal, { ...input, url })).toThrow();
});
test('rejects malformed method, path, principal and non-JSON body instead of creating a claim', () => {
  for (const changed of [
    { method: 'GET' },
    { url: 'https://untrusted.invalid/x' },
    { url: '/commands/%zz' },
    { body: { bad: NaN } },
    { body: () => 0 },
  ])
    expect(() => identifyRequest(principal, { ...input, ...changed })).toThrow();
  expect(() => identifyRequest({ type: 'USER', id: '' }, input)).toThrow();
  expect(() => identifyRequest(principal, { ...input, headers: {} })).toThrow();
});
test('keeps principal namespaces distinct and uses a literal, independently derived canonical hash', () => {
  const found = identifyRequest({ type: 'GUEST', id: principal.id }, input);
  expect(found.principal).toEqual({ type: 'GUEST', id: principal.id });
  expect(found.requestHash).toBe(
    'e2f129f09a12ebb106f55e165131c616db35b1234b863c212368e673f614f5ac',
  );
});
