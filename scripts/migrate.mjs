import { requireMigrationUrl } from '../apps/api/prisma/connections.mjs';
import { prisma, schema } from '../apps/api/prisma/cli.mjs';
import pg from 'pg';

async function revokeMigrationHistoryPrivileges(ownerUrl) {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(
      'REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM app_rw, app_ro, analytics_ro',
    );
  } finally {
    await client.end();
  }
}

try {
  const owner = requireMigrationUrl();
  process.exitCode = prisma(['migrate', 'deploy', '--schema', schema], owner);
  if (process.exitCode) {
    console.error('Migration deploy failed; check privileged configuration');
  } else {
    await revokeMigrationHistoryPrivileges(owner);
    console.info('Migration deploy succeeded');
  }
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('DATABASE_')
    ? error.message : 'Migration deploy failed; check privileged configuration');
  process.exitCode = 1;
}
