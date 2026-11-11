/**
 * HB-175 — đặt mật khẩu login cho role runtime `app_rw` trên production/staging (compose `migrate`).
 *
 * `db:dev-roles` chỉ dành cho dev: nó từ chối `NODE_ENV=production` và host ngoài loopback. Trên VPS,
 * migration (role chủ) tạo `app_rw` nhưng không đặt mật khẩu. Bước này đặt mật khẩu bằng chính mật
 * khẩu trong `DATABASE_URL` của api/worker, nên chỉ có một nguồn bí mật (`.env` trên VPS).
 *
 * Ràng buộc: `DATABASE_URL` phải dùng đúng user `app_rw` và cùng host/CSDL với `DATABASE_MIGRATION_URL`.
 * Không in URL hay mật khẩu ra log.
 */
import pg from 'pg';

function parse(name) {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} bắt buộc`);
  try {
    return new URL(raw);
  } catch {
    throw new Error(`${name} không phải URL hợp lệ`);
  }
}

let client;
try {
  const owner = parse('DATABASE_MIGRATION_URL');
  const runtime = parse('DATABASE_URL');
  if (decodeURIComponent(runtime.username) !== 'app_rw')
    throw new Error('DATABASE_URL phải dùng role app_rw');
  if (runtime.host !== owner.host || runtime.pathname !== owner.pathname)
    throw new Error('DATABASE_URL và DATABASE_MIGRATION_URL phải cùng máy chủ và CSDL');
  const password = decodeURIComponent(runtime.password);
  if (password.length < 16) throw new Error('Mật khẩu app_rw phải dài tối thiểu 16 ký tự');
  client = new pg.Client({ connectionString: owner.href, connectionTimeoutMillis: 5000 });
  await client.connect();
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_rw'");
  if (!role.rowCount) throw new Error('Chưa có role app_rw — migration chưa chạy');
  // PostgreSQL tự quote literal; mật khẩu không bao giờ thành cú pháp SQL.
  const quoted = await client.query('SELECT quote_literal($1::text) AS password', [password]);
  await client.query(`ALTER ROLE app_rw LOGIN PASSWORD ${quoted.rows[0].password}`);
  console.info('Runtime role app_rw configured');
} catch (error) {
  console.error(
    error instanceof Error && !/postgres(ql)?:\/\//.test(error.message)
      ? error.message
      : 'Runtime role setup failed',
  );
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => (process.exitCode = 1));
}
