import assert from 'node:assert/strict';
import pg from 'pg';
import { createApp } from '../../src/main.js';
import { loadConfig } from '../../src/config/env.js';

const config = loadConfig({
  ...process.env,
  JWT_ACCESS_SECRET: 'hb007-test-access',
  JWT_REFRESH_SECRET: 'hb007-test-refresh',
  BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
  LOG_LEVEL: 'silent',
});
const client = new pg.Client({
  connectionString: config.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  const identity = await client.query<{
    current_user: string;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
  }>(
    'SELECT current_user, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user',
  );
  assert.deepEqual(identity.rows, [
    { current_user: 'app_rw', rolsuper: false, rolcreatedb: false, rolcreaterole: false },
  ]);
  await client.query('SELECT id FROM users LIMIT 1');
  await assert.rejects(client.query('SELECT * FROM _prisma_migrations'), { code: '42501' });
} finally {
  await client.end();
}
const app = await createApp(config);
try {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const response = await fetch(`${await app.getUrl()}/api/v1/system/health`);
  assert.equal(response.status, 200, 'real PostgreSQL/Redis probes must be healthy');
  const body: unknown = await response.json();
  assert.deepEqual(body, { status: 'ok' });
} finally {
  await app.close();
}
process.stdout.write('Runtime app_rw privileges and real API health endpoint passed\n');
