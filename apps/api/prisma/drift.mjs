import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { requireMigrationUrl } from './connections.mjs';
import { migrations, prisma, schema } from './cli.mjs';

let admin;
let created = false;
const name = `hb005_shadow_${randomUUID().replaceAll('-', '')}`;
try {
  const owner = requireMigrationUrl();
  const shadow = new URL(owner);
  shadow.pathname = `/${name}`;
  // Never accept a caller-selected shadow: this command owns only its fresh database.
  admin = new pg.Client({ connectionString: owner, connectionTimeoutMillis: 5000 });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  process.exitCode = prisma(
    [
      'migrate',
      'diff',
      '--from-migrations',
      migrations,
      '--to-schema-datamodel',
      schema,
      '--shadow-database-url',
      shadow.href,
      '--exit-code',
    ],
    owner,
  );
  if (process.exitCode) console.error('Migration drift detected or comparison failed');
  else console.info('No drift');
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith('DATABASE_')
      ? error.message
      : 'Migration drift check failed; check privileged configuration',
  );
  process.exitCode = 1;
} finally {
  if (admin) {
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } catch {
      console.error('Temporary shadow cleanup failed');
      process.exitCode = 1;
    } finally {
      await admin.end();
    }
  }
}
