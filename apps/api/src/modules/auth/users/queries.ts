/**
 * Đọc người dùng nội bộ cho SCR-15 bằng SQL thô để lấy `version` ở độ chính xác micro-giây.
 *
 * Lựa chọn `version` (AC1): **không có cột version** trên `users`, và trigger `trg_users_touch` đặt
 * `updated_at := now()` ở mọi UPDATE ⇒ `version = micro-giây epoch của updated_at`. Prisma chỉ trả `Date`
 * (mili-giây) nên hai lần sửa trong cùng mili-giây có thể trùng version; SQL thô tránh được điều đó.
 * Hệ quả đã chấp nhận: mọi UPDATE dòng `users` (kể cả đăng nhập/khoá do sai mật khẩu) đổi version, nên
 * giao diện nhận 412 và tải lại — thận trọng chứ không bỏ sót xung đột. ETag = `"<version>"`.
 */
import { Prisma } from '@prisma/client';
import { userSummarySchema } from '@pinehill/contracts';
import type { UserSummary } from '@pinehill/contracts';

type Tx = Prisma.TransactionClient;

const COLUMNS = Prisma.sql`
  u.id::text AS id, u.username, u.full_name, u.role, u.is_active, u.locked_until,
  (extract(epoch FROM u.updated_at) * 1000000)::bigint AS version,
  EXISTS (SELECT 1 FROM user_pins p WHERE p.user_id = u.id) AS has_pin,
  COALESCE((SELECT array_agg(s.property_id::text ORDER BY s.property_id)
              FROM user_property_scopes s WHERE s.user_id = u.id), ARRAY[]::text[]) AS scope`;

interface Row {
  readonly id: string;
  readonly username: string;
  readonly full_name: string;
  readonly role: string;
  readonly is_active: boolean;
  readonly locked_until: Date | null;
  readonly version: bigint;
  readonly has_pin: boolean;
  readonly scope: string[];
}

function toSummary(row: Row, now: Date): UserSummary {
  const locked = row.locked_until !== null && row.locked_until.getTime() > now.getTime();
  return userSummarySchema.parse({
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    propertyScope: row.scope,
    isActive: row.is_active,
    lockedUntil: locked ? row.locked_until!.toISOString() : null,
    hasPin: row.has_pin,
    version: Number(row.version),
  });
}

export async function findSummary(tx: Tx, id: string, now: Date): Promise<UserSummary | null> {
  const rows = await tx.$queryRaw<Row[]>`
    SELECT ${COLUMNS} FROM users u WHERE u.id = ${id}::uuid`;
  return rows[0] === undefined ? null : toSummary(rows[0], now);
}

/** Version hiện tại của dòng `users` (dùng sau khi đã khoá hàng). */
export async function currentVersion(tx: Tx, id: string): Promise<bigint | null> {
  const rows = await tx.$queryRaw<{ version: bigint }[]>`
    SELECT (extract(epoch FROM updated_at) * 1000000)::bigint AS version
      FROM users WHERE id = ${id}::uuid`;
  return rows[0]?.version ?? null;
}

export interface UserFilters {
  readonly role?: string | undefined;
  readonly propertyId?: string | undefined;
  readonly q?: string | undefined;
  /** `null` = không giới hạn (OWNER/SYSADMIN); mảng = chỉ người có ít nhất một cơ sở trong tập này. */
  readonly scope: readonly string[] | null;
}

function where(filters: UserFilters): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (filters.role !== undefined) conditions.push(Prisma.sql`u.role = ${filters.role}`);
  if (filters.propertyId !== undefined)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM user_property_scopes s
                          WHERE s.user_id = u.id AND s.property_id = ${filters.propertyId}::uuid)`,
    );
  if (filters.q !== undefined)
    conditions.push(
      Prisma.sql`(position(lower(${filters.q}) IN lower(u.username)) > 0
               OR position(lower(${filters.q}) IN lower(u.full_name)) > 0)`,
    );
  if (filters.scope !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM user_property_scopes s
                          WHERE s.user_id = u.id AND s.property_id = ANY(${[...filters.scope]}::uuid[]))`,
    );
  return conditions;
}

const all = (conditions: Prisma.Sql[]): Prisma.Sql =>
  conditions.length === 0 ? Prisma.sql`TRUE` : Prisma.join(conditions, ' AND ');

export async function countUsers(tx: Tx, filters: UserFilters): Promise<number> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM users u WHERE ${all(where(filters))}`;
  return Number(rows[0]!.n);
}

/** Trang theo khoá `(username, id)`; `afterId` là id người dùng cuối của trang trước. */
export async function pageUsers(
  tx: Tx,
  filters: UserFilters,
  afterId: string | undefined,
  take: number,
  now: Date,
): Promise<UserSummary[]> {
  const conditions = where(filters);
  if (afterId !== undefined)
    conditions.push(
      Prisma.sql`(u.username, u.id) > (SELECT c.username, c.id FROM users c WHERE c.id = ${afterId}::uuid)`,
    );
  const rows = await tx.$queryRaw<Row[]>`
    SELECT ${COLUMNS} FROM users u WHERE ${all(conditions)}
     ORDER BY u.username, u.id LIMIT ${take}`;
  return rows.map((row) => toSummary(row, now));
}
