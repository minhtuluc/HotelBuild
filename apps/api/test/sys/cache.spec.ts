import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { test, expect } from 'vitest';
import {
  RUNTIME_SETTINGS,
  type RuntimeSettings,
} from '../../src/modules/sys/settings/runtime-port.js';
import { application, rows, clock, login, put, databaseUrl } from './fixture.js';
const reader = () => application().get<RuntimeSettings>(RUNTIME_SETTINGS);
test('runtime reader caches immutable values for less than or equal to60s, using injected clock', async () => {
  const cache = reader();
  expect(await cache.get('refund.feeAmount')).toBe('0');
  await rows("UPDATE system_settings SET value='1000' WHERE key='refund.feeAmount'");
  clock.value += 59999;
  expect(await cache.get('refund.feeAmount')).toBe('0');
  clock.value += 1;
  expect(await cache.get('refund.feeAmount')).toBe('1000');
});
test('own committed write immediately invalidates runtime cache; old replay cannot repopulate old data', async () => {
  const cache = reader(),
    token = await login(),
    key = randomUUID();
  expect(await cache.get('refund.feeAmount')).toBe('0');
  expect((await put(token, '1000', 'refund.feeAmount', '"1"', key)).status).toBe(204);
  expect(await cache.get('refund.feeAmount')).toBe('1000');
  expect((await put(token, '2000', 'refund.feeAmount', '"2"')).status).toBe(204);
  expect((await put(token, '1000', 'refund.feeAmount', '"1"', key)).status).toBe(204);
  expect(await cache.get('refund.feeAmount')).toBe('2000');
});
test('audit rollback does not invalidate a cached value before commit', async () => {
  const cache = reader(),
    token = await login();
  expect(await cache.get('refund.feeAmount')).toBe('0');
  await rows("UPDATE system_settings SET value='1000' WHERE key='refund.feeAmount'");
  await rows(
    `CREATE FUNCTION hb036_cache_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SYSTEM_SETTING_UPDATED' THEN RAISE EXCEPTION 'Synthetic failure'; END IF; RETURN NEW; END $$`,
  );
  await rows(
    'CREATE TRIGGER hb036_cache_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION hb036_cache_fail()',
  );
  try {
    expect((await put(token, '2000', 'refund.feeAmount', '"2"')).status).toBe(500);
    expect(await cache.get('refund.feeAmount')).toBe('0');
  } finally {
    await rows('DROP TRIGGER hb036_cache_fail ON audit_logs');
    await rows('DROP FUNCTION hb036_cache_fail()');
  }
});
test('missing keys are not negatively cached; backwards clock cannot prolong old cache', async () => {
  const cache = reader();
  await expect(cache.get('test.missing')).rejects.toMatchObject({ status: 404 });
  await rows(
    "INSERT INTO system_settings(key,value,value_type) VALUES('test.missing','Synthetic','STRING')",
  );
  expect(await cache.get('test.missing')).toBe('Synthetic');
  expect(await cache.get('refund.feeAmount')).toBe('0');
  await rows("UPDATE system_settings SET value='1000' WHERE key='refund.feeAmount'");
  clock.value -= 1000;
  expect(await cache.get('refund.feeAmount')).toBe('1000');
});
test('in-flight DB load cannot repopulate cache after invalidation', async () => {
  const cache = reader(),
    blocker = new pg.Client({ connectionString: databaseUrl });
  await blocker.connect();
  let pending: Promise<string> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE system_settings IN ACCESS EXCLUSIVE MODE');
    pending = cache.get('refund.feeAmount');
    await expect
      .poll(
        async () =>
          Number(
            (
              await rows(
                "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%system_settings%'",
              )
            )[0]!.n,
          ),
        { timeout: 3000 },
      )
      .toBeGreaterThan(0);
    cache.invalidate('refund.feeAmount');
    await blocker.query("UPDATE system_settings SET value='2000' WHERE key='refund.feeAmount'");
    await blocker.query('COMMIT');
    await pending;
    await rows("UPDATE system_settings SET value='3000' WHERE key='refund.feeAmount'");
    expect(await cache.get('refund.feeAmount')).toBe('3000');
  } finally {
    await blocker.query('ROLLBACK');
    await pending;
    await blocker.end();
  }
});
