import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const owner = process.env.DATABASE_MIGRATION_URL;

interface Booking {
  id: string;
}
function isFixtureModule(value: unknown): value is {
  fixture: (client: { query: pg.Client['query'] }) => Promise<{
    booking: (overrides?: Record<string, unknown>) => Promise<Booking>;
  }>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fixture' in value &&
    typeof value.fixture === 'function'
  );
}
// Helper nằm ngoài `include` của tsconfig và không có allowJs, nên không thể import tĩnh.
const helpers: unknown = await import(`${root}tests/helpers/database.mjs`);
if (!isFixtureModule(helpers)) throw new Error('Database fixture unavailable');

/** Lỗi pg mang SQLSTATE ở `code`; đọc bằng type guard thay vì ép kiểu. */
function failureOf(caught: unknown): { code: string | undefined; message: string } | undefined {
  if (typeof caught !== 'object' || caught === null) return undefined;
  const code = 'code' in caught && typeof caught.code === 'string' ? caught.code : undefined;
  const message = 'message' in caught && typeof caught.message === 'string' ? caught.message : '';
  return { code, message };
}

describe('HB-214 refund cap guard (BR-CANCEL-17, BR-PAY-07, TC-PAY-21)', () => {
  const name = `hb214_refund_cap_${randomUUID().replaceAll('-', '')}`;
  const clients: pg.Client[] = [];
  let admin: pg.Client | undefined;
  let db: pg.Client | undefined;
  let url = '';
  let serial = 0;
  let makeBooking: () => Promise<Booking>;
  const client = () => {
    if (!db) throw new Error('Database not connected');
    return db;
  };

  function insertPayment(values: Record<string, unknown>) {
    const keys = Object.keys(values);
    return client().query<{ id: string; amount: string; status: string }>(
      `INSERT INTO payments (${keys.join(',')}) VALUES (${keys
        .map((_, index) => `$${index + 1}`)
        .join(',')}) RETURNING id, amount, status`,
      Object.values(values),
    );
  }

  const collected = (bookingId: string, amount: number) =>
    insertPayment({
      booking_id: bookingId,
      type: 'DEPOSIT',
      method: 'BANK_TRANSFER',
      amount,
      status: 'SUCCEEDED',
      idempotency_key: `hb214-income:${++serial}`,
      paid_at: new Date(),
    });

  const refund = (bookingId: string, amount: number, status = 'PENDING') =>
    insertPayment({
      booking_id: bookingId,
      type: 'REFUND',
      method: 'BANK_TRANSFER',
      amount: -amount,
      status,
      idempotency_key: `hb214-refund:${++serial}`,
    });

  async function expectRejected(statement: Promise<unknown>) {
    let error: ReturnType<typeof failureOf> = undefined;
    try {
      await statement;
    } catch (caught) {
      error = failureOf(caught);
    }
    expect(error, 'CSDL phải từ chối dòng làm vượt trần hoàn').toBeDefined();
    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('BR-CANCEL-17');
  }

  beforeAll(async () => {
    if (!owner) throw new Error('HB-214 requires real PostgreSQL16 owner URL; no fallback');
    admin = new pg.Client({ connectionString: owner });
    await admin.connect();
    const version = Number(
      (await admin.query<{ server_version_num: string }>('SHOW server_version_num')).rows[0]
        ?.server_version_num,
    );
    expect(version).toBeGreaterThanOrEqual(160000);
    expect(version).toBeLessThan(170000);
    await admin.query(`CREATE DATABASE "${name}"`);
    const parsed = new URL(owner);
    parsed.pathname = `/${name}`;
    url = parsed.href;
    db = new pg.Client({ connectionString: url });
    await db.connect();
    await db.query("SET statement_timeout='10s'");
    const migrate = spawnSync(process.execPath, [`${root}scripts/migrate.mjs`], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, DATABASE_URL: '', DATABASE_MIGRATION_URL: url },
    });
    expect(migrate.status, migrate.stderr).toBe(0);
    const fixture = await helpers.fixture({ query: db.query.bind(db) });
    makeBooking = fixture.booking;
  }, 90000);

  afterAll(async () => {
    for (const connection of clients) await connection.end().catch(() => undefined);
    await db?.end();
    try {
      if (admin) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await admin?.end();
    }
  });

  it('rejects an INSERT whose cumulative refund exceeds collected SUCCEEDED money', async () => {
    const row = await makeBooking();
    await collected(row.id, 1_000);
    await expectRejected(refund(row.id, 1_001));
    const rows = await client().query('SELECT id FROM payments WHERE booking_id=$1', [row.id]);
    expect(rows.rowCount).toBe(1);
  });

  it('accepts cumulative refunds exactly equal to collected money and rejects the next dong', async () => {
    const row = await makeBooking();
    await collected(row.id, 1_000);
    await refund(row.id, 600);
    await refund(row.id, 400);
    await expectRejected(refund(row.id, 1));
    const total = await client().query<{ refunded: string }>(
      "SELECT -sum(amount) AS refunded FROM payments WHERE booking_id=$1 AND type='REFUND'",
      [row.id],
    );
    expect(total.rows[0]?.refunded).toBe('1000');
  });

  it('serialises two concurrent refunds on the booking lock so only one passes', async () => {
    const row = await makeBooking();
    await collected(row.id, 1_000);
    const a = new pg.Client({ connectionString: url });
    const b = new pg.Client({ connectionString: url });
    clients.push(a, b);
    await Promise.all([a.connect(), b.connect()]);
    const attempt = async (
      connection: pg.Client,
      key: string,
    ): Promise<{ ok: boolean; code: string | undefined; message: string }> => {
      await connection.query('BEGIN');
      try {
        await connection.query(
          `INSERT INTO payments (booking_id, type, method, amount, status, idempotency_key,
             created_at, updated_at)
           VALUES ($1::uuid, 'REFUND', 'BANK_TRANSFER', -600, 'PENDING', $2, now(), now())`,
          [row.id, key],
        );
        // Giữ khoá booking trong lúc transaction kia đang chờ để phép thử là đồng thời thật.
        await connection.query('SELECT pg_sleep(0.4)');
        await connection.query('COMMIT');
        return { ok: true, code: undefined, message: '' };
      } catch (caught) {
        await connection.query('ROLLBACK');
        const error = failureOf(caught);
        return { ok: false, code: error?.code, message: error?.message ?? '' };
      }
    };
    const results = await Promise.all([
      attempt(a, `hb214-race-a:${++serial}`),
      attempt(b, `hb214-race-b:${++serial}`),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const loser = results.find((result) => !result.ok);
    expect(loser?.code).toBe('23514');
    expect(loser?.message).toContain('BR-CANCEL-17');
    const rows = await client().query(
      "SELECT id FROM payments WHERE booking_id=$1 AND type='REFUND' AND status<>'FAILED'",
      [row.id],
    );
    expect(rows.rowCount).toBe(1);
  });

  it('rejects a single multi-row INSERT whose rows together exceed the cap', async () => {
    const row = await makeBooking();
    await collected(row.id, 1_000);
    let error: ReturnType<typeof failureOf> = undefined;
    try {
      await client().query(
        `INSERT INTO payments (booking_id, type, method, amount, status, idempotency_key)
         VALUES ($1, 'REFUND', 'BANK_TRANSFER', -600, 'PENDING', $2),
                ($1, 'REFUND', 'BANK_TRANSFER', -600, 'PENDING', $3)`,
        [row.id, `hb214-multi-a:${++serial}`, `hb214-multi-b:${++serial}`],
      );
    } catch (caught) {
      error = failureOf(caught);
    }
    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('BR-CANCEL-17');
    const rows = await client().query(
      "SELECT id FROM payments WHERE booking_id=$1 AND type='REFUND'",
      [row.id],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('ignores FAILED refunds and rejects promoting one past the cap', async () => {
    const row = await makeBooking();
    await collected(row.id, 1_000);
    const failed = await refund(row.id, 5_000, 'FAILED');
    await refund(row.id, 900);
    await expectRejected(refund(row.id, 101));
    await expectRejected(
      client().query("UPDATE payments SET status='PENDING' WHERE id=$1", [failed.rows[0]?.id]),
    );
    const status = await client().query<{ status: string }>(
      'SELECT status FROM payments WHERE id=$1',
      [failed.rows[0]?.id],
    );
    expect(status.rows[0]?.status).toBe('FAILED');
  });

  it('registers the trigger on payments and revokes PUBLIC execute per TD-12', async () => {
    const triggers = await client().query<{ table: string }>(
      `SELECT tgrelid::regclass::text AS table FROM pg_trigger
        WHERE tgname IN ('trg_payments_refund_cap', 'trg_payments_refund_cap_check')
          AND NOT tgisinternal ORDER BY tgname`,
    );
    expect(triggers.rows).toEqual([{ table: 'payments' }, { table: 'payments' }]);
    const acl = await client().query<{
      name: string;
      public_execute: boolean;
      app_rw_execute: boolean;
    }>(
      `SELECT p.proname AS name,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
         has_function_privilege('app_rw', p.oid, 'EXECUTE') AS app_rw_execute
         FROM pg_proc p
        WHERE p.proname IN ('fn_lock_refund_booking', 'fn_guard_refund_cap')
        ORDER BY p.proname`,
    );
    expect(acl.rows).toEqual([
      { name: 'fn_guard_refund_cap', public_execute: false, app_rw_execute: true },
      { name: 'fn_lock_refund_booking', public_execute: false, app_rw_execute: true },
    ]);
  });
});
