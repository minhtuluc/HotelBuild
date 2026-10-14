import { requireMigrationUrl } from '../apps/api/prisma/connections.mjs';
import { prisma, schema } from '../apps/api/prisma/cli.mjs';
import pg from 'pg';

// Published csdl §8.3 definitions, rendered by PostgreSQL 16 with pg_catalog first.
const requiredExclusions = new Map([
  [
    'excl_booking_room_one_assignment',
    `EXCLUDE USING gist
    (booking_room_id WITH =, valid_range WITH &&) WHERE ((released_at IS NULL))`,
  ],
  [
    'excl_room_assignments_no_double_booking',
    `EXCLUDE USING gist (room_id WITH =, (
    CASE
      WHEN (bed_no = 0) THEN int4range(0, NULL::integer, '[)'::text)
      ELSE int4range((bed_no)::integer, ((bed_no)::integer + 1), '[)'::text)
    END) WITH &&, valid_range WITH &&) WHERE ((released_at IS NULL))`,
  ],
]);
const verificationErrors = new Set([
  'MIGRATION_VERIFY_PRIMARY_KEYS',
  'MIGRATION_VERIFY_EXCLUSIONS',
  'MIGRATION_VERIFY_AUDIT_UPDATE',
]);
const normalize = (definition) => definition.replace(/\s+/g, ' ').trim();

async function verifySchema(client) {
  // One consistent, read-only catalog snapshot; never repair schema or ACL drift here.
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query('SET LOCAL search_path = pg_catalog, public');
  await client.query("SET LOCAL statement_timeout = '5s'");
  await client.query("SET LOCAL lock_timeout = '3s'");
  const missingKeys = await client.query(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT EXISTS (SELECT 1 FROM pg_constraint k
        WHERE k.conrelid = c.oid AND k.contype = 'p')`);
  if (missingKeys.rows.length) throw new Error('MIGRATION_VERIFY_PRIMARY_KEYS');
  const exclusions = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid = 'public.room_assignments'::regclass AND contype = 'x'`);
  const definitions = new Map(exclusions.rows.map((row) => [row.conname, row.definition]));
  for (const [name, definition] of requiredExclusions) {
    if (normalize(definitions.get(name) ?? '') !== normalize(definition)) {
      throw new Error('MIGRATION_VERIFY_EXCLUSIONS');
    }
  }
  const audit = await client.query(
    "SELECT has_table_privilege('app_rw', 'public.audit_logs', 'UPDATE') AS can_update",
  );
  if (audit.rows[0]?.can_update !== false) throw new Error('MIGRATION_VERIFY_AUDIT_UPDATE');
  await client.query('COMMIT');
}

async function postMigration(ownerUrl) {
  const client = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query(
      'REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM app_rw, app_ro, analytics_ro',
    );
    await verifySchema(client);
  } finally {
    // Closing also rolls back a failed read-only verification transaction.
    await client.end();
  }
}

try {
  const owner = requireMigrationUrl();
  process.exitCode = prisma(['migrate', 'deploy', '--schema', schema], owner);
  if (process.exitCode) {
    console.error('Migration deploy failed; check privileged configuration');
  } else {
    await postMigration(owner);
    console.info('Migration deploy succeeded');
  }
} catch (error) {
  const safeMessage =
    error instanceof Error &&
    (error.message.startsWith('DATABASE_') || verificationErrors.has(error.message));
  console.error(
    safeMessage ? error.message : 'Migration deploy failed; check privileged configuration',
  );
  process.exitCode = 1;
}
