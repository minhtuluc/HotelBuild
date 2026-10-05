/**
 * `owner:bootstrap` — tạo OWNER đầu tiên cho môi trường thật (HB-018 AC3).
 *
 * Chỉ chạy khi **chưa có OWNER đang hoạt động**; tài khoản tạo ra có `must_change_password = true`
 * (bắt đổi mật khẩu ở lần đăng nhập đầu) và được ghi `AuditLog` với actor `SYSTEM`. Mật khẩu **không**
 * bao giờ được in ra. Chạy lại khi đã có OWNER ⇒ từ chối.
 */
import { pathToFileURL } from 'node:url';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

export interface BootstrapInput {
  connectionString: string;
  username: string;
  password: string;
}

export interface BootstrapResult {
  userId: string;
  username: string;
}

export function bootstrapConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim() || env.DATABASE_MIGRATION_URL?.trim();
  if (url === undefined || url === '') {
    throw new Error('Cần DATABASE_URL hoặc DATABASE_MIGRATION_URL để tạo OWNER');
  }
  return url;
}

export function bootstrapCredentials(env: NodeJS.ProcessEnv = process.env): {
  username: string;
  password: string;
} {
  const username = env.BOOTSTRAP_OWNER_USERNAME?.trim();
  const password = env.BOOTSTRAP_OWNER_PASSWORD;
  if (username === undefined || username === '') {
    throw new Error('Thiếu BOOTSTRAP_OWNER_USERNAME');
  }
  if (password === undefined || password.length < 8) {
    throw new Error('BOOTSTRAP_OWNER_PASSWORD phải có ít nhất 8 ký tự');
  }
  return { username, password };
}

/** Tạo OWNER đầu tiên; ném lỗi khi đã tồn tại OWNER đang hoạt động. */
export async function bootstrapOwner(input: BootstrapInput): Promise<BootstrapResult> {
  const client = new pg.Client({ connectionString: input.connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE role = 'OWNER' AND is_active`,
    );
    if ((existing.rows[0]?.count ?? '0') !== '0') {
      throw new Error('Đã có OWNER đang hoạt động — không tạo thêm');
    }
    // Argon2id (mặc định của `@node-rs/argon2`, QĐ-03 T1); test khẳng định tiền tố `$argon2id$`.
    const passwordHash = await hash(input.password);
    const created = await client.query<{ id: string }>(
      `INSERT INTO users (username, password_hash, full_name, role, must_change_password)
       VALUES ($1,$2,$3,'OWNER',true)
       RETURNING id`,
      [input.username, passwordHash, input.username],
    );
    const userId = created.rows[0]?.id;
    if (userId === undefined) throw new Error('Không tạo được OWNER');
    // `chain_seq`/`row_hash` do trigger chuỗi băm của DB cấp (csdl §8.1 mục 3) — không tự tính ở đây.
    await client.query(
      `INSERT INTO audit_logs (actor_role, action, entity_type, entity_id, reason, after_json)
       VALUES ('SYSTEM','UserBootstrap','users',$1,$2,$3::jsonb)`,
      [
        userId,
        'Tạo OWNER đầu tiên qua owner:bootstrap',
        JSON.stringify({ username: input.username, role: 'OWNER' }),
      ],
    );
    await client.query('COMMIT');
    return { userId, username: input.username };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Điểm vào của lệnh. Tách khỏi phần chạy tự động để test gọi trực tiếp (và để mã này được phủ).
 * Không in mật khẩu; chỉ thông báo đã tạo và yêu cầu đổi ở lần đăng nhập đầu.
 */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const { username, password } = bootstrapCredentials(env);
  const result = await bootstrapOwner({
    connectionString: bootstrapConnectionString(env),
    username,
    password,
  });
  process.stdout.write(
    `Đã tạo OWNER "${result.username}" (id ${result.userId}); phải đổi mật khẩu lần đầu.\n`,
  );
  return result.userId;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Bootstrap OWNER thất bại');
    process.exitCode = 1;
  });
}
