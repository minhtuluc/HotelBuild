import { requireMigrationUrl } from '../apps/api/prisma/connections.mjs';
import { prisma, schema } from '../apps/api/prisma/cli.mjs';

try {
  const owner = requireMigrationUrl();
  process.exitCode = prisma(['migrate', 'deploy', '--schema', schema], owner);
  if (process.exitCode) console.error('Migration deploy failed; check privileged configuration');
  else console.info('Migration deploy succeeded');
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('DATABASE_')
    ? error.message : 'Migration deploy failed; check privileged configuration');
  process.exitCode = 1;
}
