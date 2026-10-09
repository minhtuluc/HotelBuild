import { randomUUID } from 'node:crypto';
import { test, expect } from 'vitest';
import { errorBodySchema } from '@pinehill/contracts';
import {
  http,
  login,
  versionChecks,
  scopeChecks,
  setFailure,
  context,
  appRedis,
  setCommandBarrier,
  transactions,
  setUpstreamHeader,
} from './http-fixture.js';
import {
  db,
  rows,
  count,
  auditCount,
  userId,
  secondUserId,
  propertyId,
  otherPropertyId,
} from './database.js';
const post = (token: string, key: string = randomUUID(), property = propertyId) =>
  http()
    .post(`/api/v1/idempotency-probe/${property}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key);
for (const header of [
  { name: 'Content-Encoding', value: 'gzip' },
  { name: 'X-New-Header', value: 'bad\nvalue' },
])
  test(`replay validates newly added upstream ${header.name} and returns safe JSON error`, async () => {
    const token = await login(),
      key = randomUUID(),
      first = await post(token, key).send({ a: 1 });
    expect(first.status).toBe(201);
    setUpstreamHeader(header);
    try {
      const result = await post(token, key)
        .send({ a: 1 })
        .timeout({ response: 1500, deadline: 2500 })
        .then(
          (response) => {
            const body: unknown = response.body;
            return { status: response.status, body };
          },
          (_error: unknown) => ({ status: 0, body: undefined }),
        );
      expect(result.status).toBe(500);
      expect(errorBodySchema.parse(result.body).code).toBe('E_GEN_SERVICE_UNAVAILABLE');
    } finally {
      setUpstreamHeader(undefined);
    }
    const replay = await post(token, key).send({ a: 1 });
    expect(replay.body).toEqual(first.body);
    expect(await count()).toBe(1);
    expect(versionChecks).toBe(1);
  });
for (const route of ['bad-media', 'bad-header', 'bad-encoding'])
  test(`${route} fails safely before commit and still returns a valid JSON error`, async () => {
    const token = await login(),
      before = await auditCount();
    const result = await http()
      .post(`/api/v1/idempotency-probe/${route}/${propertyId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ a: 1 })
      .timeout({ response: 1500, deadline: 2500 })
      .then(
        (response) => {
          const body: unknown = response.body;
          return { status: response.status, body };
        },
        (_error: unknown) => ({ status: 0, body: undefined }),
      );
    expect(await count()).toBe(0);
    expect(await auditCount()).toBe(before);
    expect(await db.idempotency_keys.count()).toBe(0);
    expect(result.status).toBe(500);
    expect(errorBodySchema.parse(result.body).code).toBe('E_GEN_SERVICE_UNAVAILABLE');
  });
test('scalar JSON strings serialize as valid JSON for both first response and replay', async () => {
  const token = await login(),
    key = randomUUID();
  const call = () =>
    http()
      .post(`/api/v1/idempotency-probe/scalar/${propertyId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ a: 1 });
  const first = await call().then(
    (response) => ({ status: response.status, text: response.text }),
    (_error: unknown) => ({ status: 0, text: '' }),
  );
  expect(first.status).toBe(201);
  expect(first.text).toBe('"ok"');
  const replay = await call();
  expect(replay.text).toBe('"ok"');
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(await count()).toBe(1);
});
test('HTTP retry replays status/body/Location after fresh auth/scope and before stale If-Match', async () => {
  const token = await login(),
    key = randomUUID(),
    before = await auditCount();
  const first = await post(token, key)
    .set('If-Match', '"0"')
    .set('X-Correlation-Id', randomUUID())
    .send({ b: 2, a: 1 });
  const second = await post(token, key)
    .set('If-Match', '"0"')
    .set('X-Correlation-Id', randomUUID())
    .send({ a: 1, b: 2 });
  expect(first.status).toBe(201);
  expect(first.body).toEqual({ actorId: userId, value: 1 });
  expect(second.status).toBe(201);
  expect(second.body).toEqual(first.body);
  expect(second.headers.location).toBe(first.headers.location);
  expect(first.headers.location).toBe('/api/v1/idempotency-probe/result');
  expect(second.headers['idempotency-replayed']).toBe('true');
  expect(first.headers['idempotency-replayed']).toBeUndefined();
  expect(second.headers['x-trace-id']).not.toBe(first.headers['x-trace-id']);
  expect(versionChecks).toBe(1);
  expect(scopeChecks).toBe(2);
  expect(await count()).toBe(1);
  expect(await auditCount()).toBe(before + 1);
  expect(() => context().transaction()).toThrow();
});
test('changed payload and If-Match conflict without invoking the handler again', async () => {
  const token = await login(),
    key = randomUUID();
  expect((await post(token, key).send({ a: 1 })).status).toBe(201);
  for (const call of [
    post(token, key).send({ a: 2 }),
    post(token, key).set('If-Match', '"1"').send({ a: 1 }),
  ]) {
    const result = await call;
    expect(result.status).toBe(409);
    expect(errorBodySchema.parse(result.body).code).toBe('E_SYS_IDEMPOTENCY_KEY_REUSED');
  }
  expect(versionChecks).toBe(1);
  expect(await count()).toBe(1);
});
test('authentication and current role permissions run before any stored response is read', async () => {
  const token = await login(),
    key = randomUUID();
  await post(token, key).send({ a: 1 });
  expect(
    (
      await http()
        .post(`/api/v1/idempotency-probe/${propertyId}`)
        .set('Idempotency-Key', key)
        .send({ a: 1 })
    ).status,
  ).toBe(401);
  await rows("UPDATE users SET role='HOUSEKEEPING' WHERE id=$1::uuid", [userId]);
  const result = await post(token, key).send({ role: 'OWNER', propertyScope: [propertyId], a: 1 });
  expect(result.status).toBe(403);
  expect(errorBodySchema.parse(result.body).code).toBe('E_RBAC_FORBIDDEN');
  expect(result.body).not.toHaveProperty('actorId');
  expect(await count()).toBe(1);
});
test('current scope is checked before replay and body scope cannot bypass it', async () => {
  const token = await login(),
    key = randomUUID();
  await post(token, key).send({ a: 1 });
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [userId]);
  const denied = await post(token, key).send({ a: 1, propertyScope: [propertyId] });
  expect(denied.status).toBe(403);
  expect(errorBodySchema.parse(denied.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
  expect(denied.body).not.toHaveProperty('actorId');
  expect(await count()).toBe(1);
});
test('out-of-scope first request creates no claim or effect', async () => {
  const denied = await post(await login(), randomUUID(), otherPropertyId).send({
    role: 'OWNER',
    propertyScope: [otherPropertyId],
  });
  expect(denied.status).toBe(403);
  expect(await db.idempotency_keys.count()).toBe(0);
  expect(await count()).toBe(0);
});
test('a second authenticated principal reusing the same key gets only its own result', async () => {
  const first = await login(),
    second = await login('h029-second'),
    key = randomUUID();
  const one = await post(first, key).send({ a: 1 }),
    two = await post(second, key).send({ a: 1 });
  expect(one.body).toEqual({ actorId: userId, value: 1 });
  expect(two.body).toEqual({ actorId: secondUserId, value: 2 });
  expect(two.headers['idempotency-replayed']).toBeUndefined();
  expect(await count()).toBe(2);
});
test('missing and malformed keys fail validation before command effects', async () => {
  const token = await login();
  const missing = await http()
    .post(`/api/v1/idempotency-probe/${propertyId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ a: 1 });
  expect(missing.status).toBe(400);
  expect((await post(token, 'not-a-uuid').send({ a: 1 })).status).toBe(400);
  expect(await count()).toBe(0);
});
for (const failure of ['handler', 'audit', 'secret'] as const)
  test(`${failure} failure rolls back effect/audit/cache together`, async () => {
    const token = await login(),
      before = await auditCount();
    setFailure(failure);
    const result = await post(token).send({ a: 1 });
    expect(result.status).toBe(failure === 'handler' ? 412 : 500);
    expect(await count()).toBe(0);
    expect(await auditCount()).toBe(before);
    expect(await db.idempotency_keys.count()).toBe(0);
  });
const barrier = () => {
  let release: () => void = () => {
    throw new Error('No barrier');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
test('two concurrent HTTP requests with one key return busy then replay with exactly one effect', async () => {
  const token = await login(),
    key = randomUUID(),
    entered = barrier(),
    finish = barrier();
  setCommandBarrier(async () => {
    entered.release();
    await finish.promise;
  });
  const first = post(token, key)
    .send({ a: 1 })
    .then((value) => value);
  try {
    await entered.promise;
    const busy = await post(token, key).send({ a: 1 });
    expect(busy.status).toBe(409);
    expect(errorBodySchema.parse(busy.body).code).toBe('E_SYS_REQUEST_IN_PROGRESS');
    expect(busy.headers['retry-after']).toBe('1');
  } finally {
    finish.release();
  }
  const original = await first,
    retry = await post(token, key).send({ a: 1 });
  expect(original.status).toBe(201);
  expect(retry.status).toBe(201);
  expect(retry.body).toEqual(original.body);
  expect(retry.headers['idempotency-replayed']).toBe('true');
  expect(await count()).toBe(1);
  expect(versionChecks).toBe(1);
});
test('concurrent commands retain separate AsyncLocalStorage transactions across awaits', async () => {
  const token = await login(),
    both = barrier(),
    finish = barrier();
  let entered = 0;
  setCommandBarrier(async () => {
    if (++entered === 2) both.release();
    await finish.promise;
  });
  const first = post(token)
      .send({ a: 1 })
      .then((value) => value),
    second = post(token)
      .send({ a: 2 })
      .then((value) => value);
  try {
    await both.promise;
  } finally {
    finish.release();
  }
  const responses = await Promise.all([first, second]);
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  expect(new Set(transactions).size).toBe(2);
  expect(await count()).toBe(2);
});
test('disconnecting the actual application Redis client cannot affect durable replay', async () => {
  const token = await login(),
    key = randomUUID(),
    first = await post(token, key).send({ a: 1 });
  const redis = appRedis();
  redis.disconnect();
  try {
    const replay = await post(token, key).send({ a: 1 });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(await count()).toBe(1);
  } finally {
    await redis.connect();
  }
});
test('failure persisting response rolls back the already executed business operation and audit', async () => {
  const token = await login(),
    before = await auditCount();
  await rows(
    "CREATE FUNCTION h029_response_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.status='COMPLETED' THEN RAISE EXCEPTION 'Synthetic response failure'; END IF; RETURN NEW; END$$",
  );
  await rows(
    'CREATE TRIGGER h029_fail_response BEFORE UPDATE ON idempotency_keys FOR EACH ROW EXECUTE FUNCTION h029_response_failure()',
  );
  try {
    const result = await post(token).send({ a: 1 });
    expect(result.status).toBe(500);
    expect(await count()).toBe(0);
    expect(await auditCount()).toBe(before);
    expect(await db.idempotency_keys.count()).toBe(0);
  } finally {
    await rows('DROP TRIGGER h029_fail_response ON idempotency_keys');
    await rows('DROP FUNCTION h029_response_failure()');
  }
});
