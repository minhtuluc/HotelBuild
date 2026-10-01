import pg from 'pg';
import { requireDevRoleConfig } from './connections.mjs';

let client;
try {
  const { ownerUrl, password } = requireDevRoleConfig();
  client = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_rw'");
  if (!role.rowCount) throw new Error('Run migrations before db:dev-roles');
  // PostgreSQL quotes the literal itself; user input never becomes SQL syntax.
  const quoted = await client.query('SELECT quote_literal($1::text) AS password', [password]);
  await client.query(`ALTER ROLE app_rw LOGIN PASSWORD ${quoted.rows[0].password}`);
  console.info('Development app_rw login configured');
} catch (error) {
  const message =
    error instanceof Error && /^(DATABASE_|NODE_ENV|Run migrations)/.test(error.message)
      ? error.message
      : 'Development role setup failed; check DATABASE_MIGRATION_URL and existing app_rw role';
  console.error(message);
  process.exitCode = 1;
} finally {
  if (client)
    await client.end().catch(() => {
      process.exitCode = 1;
    });
}
