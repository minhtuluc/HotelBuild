/**
 * HB-182 — năm phép dò trên dữ liệu **đã có** (không bảng/cột mới), mỗi phép trả về tối đa một trang
 * (`ALERTS_SCAN_BATCH_SIZE`) nên lượt quét luôn ngắn và lặp lại được.
 *
 * Nguồn chứng cứ:
 * 1. `room_assignments` ⋈ `room_blocks` (phòng vừa bán vừa bị khoá — nhánh MANAGER/OWNER được phép ghi đè
 *    ở `fn_guard_room_block_overlap`) và cặp phân công trùng **cùng đơn vị bán** (lưới an toàn BR-INV-03:
 *    ràng buộc loại trừ lẽ ra đã chặn, nên hàng lọt ra là bất thường dữ liệu thật).
 * 2. `channel_allotments.used > allotment + ngưỡng` (bán vượt hạn mức kênh, BR-CHAN-05/08).
 * 3. `channels.sync_status = 'DEGRADED'` hoặc `consecutive_sync_failures ≥ ngưỡng` (BR-CHAN-07).
 * 4. `users.failed_login_count`/`locked_until` và `audit_logs` `AUTH_LOGIN_FAILURE` có `clientSurface`
 *    ngoài danh sách hợp lệ (BR-RBAC-06, NFR-SEC-05).
 * 5. `refund_requests` đã duyệt nhưng chưa chi quá hạn cam kết (BR-CANCEL-12).
 *
 * Mọi mốc thời gian lấy từ `clock_timestamp()` của CSDL (BR-BOOK-18) — đồng hồ tiến trình không tham gia.
 */
import type { PrismaClient } from '@prisma/client';
import type { AlertCondition, AlertSettings } from './catalog.js';

export interface AlertFinding {
  readonly condition: AlertCondition;
  /** Đối tượng của sự cố — thành phần khoá chống trùng, không bao giờ chứa PII. */
  readonly subject: string;
  /** Nội dung thư/nhật ký, ≤ 400 ký tự, không PII. */
  readonly detail: string;
  /** Cơ sở của sự cố (nếu xác định được) — để MANAGER chỉ đọc cảnh báo trong phạm vi của mình. */
  readonly propertyId: string | null;
}

const day = (value: Date): string => value.toISOString().slice(0, 10);

/** Chặn chuỗi do client gửi lên (bề mặt đăng nhập) lọt nguyên vào khoá Redis/nội dung thư. */
const safeLabel = (value: string): string => value.replaceAll(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40);

async function roomConflicts(
  db: PrismaClient,
  limit: number,
  found: AlertFinding[],
  seen: Set<string>,
): Promise<void> {
  const blocks = await db.$queryRaw<
    { room_id: string; room_code: string; property_id: string; start_date: Date; end_date: Date }[]
  >`
    SELECT ra.room_id, r.code AS room_code, r.property_id, ra.start_date, ra.end_date
      FROM room_assignments ra
      JOIN room_blocks b ON b.room_id = ra.room_id
       AND daterange(b.start_date, b.end_date, '[)') && ra.valid_range
      JOIN rooms r ON r.id = ra.room_id
     WHERE ra.released_at IS NULL
     ORDER BY ra.room_id, ra.start_date
     LIMIT ${limit}`;
  for (const row of blocks) {
    const subject = `room:${row.room_id}`;
    if (seen.has(subject)) continue;
    seen.add(subject);
    found.push({
      condition: 'ROOM_ASSIGNMENT_CONFLICT',
      subject,
      propertyId: row.property_id,
      detail:
        `Phòng ${row.room_code} có phân công đang hiệu lực ${day(row.start_date)} → ` +
        `${day(row.end_date)} nhưng đồng thời bị khoá. Kiểm tra lịch phòng trước khi nhận khách.`,
    });
  }
  const duplicates = await db.$queryRaw<
    { room_id: string; room_code: string; property_id: string; bed_no: number }[]
  >`
    SELECT a.room_id, r.code AS room_code, r.property_id, a.bed_no
      FROM room_assignments a
      JOIN room_assignments b ON b.room_id = a.room_id AND a.id < b.id
       AND a.bed_no = b.bed_no AND a.valid_range && b.valid_range
      JOIN rooms r ON r.id = a.room_id
     WHERE a.released_at IS NULL AND b.released_at IS NULL
     LIMIT ${limit}`;
  for (const row of duplicates) {
    const subject = `room:${row.room_id}`;
    if (seen.has(subject)) continue;
    seen.add(subject);
    found.push({
      condition: 'ROOM_ASSIGNMENT_CONFLICT',
      subject,
      propertyId: row.property_id,
      detail:
        `Phòng ${row.room_code} bị gán trùng đơn vị bán ${row.bed_no === 0 ? 'cả phòng' : `giường ${row.bed_no}`} ` +
        'trong cùng khoảng ngày — ràng buộc loại trừ BR-INV-03 đã bị vượt qua.',
    });
  }
}

async function inventoryOverbook(
  db: PrismaClient,
  limit: number,
  threshold: number,
  found: AlertFinding[],
): Promise<void> {
  const rows = await db.$queryRaw<
    {
      channel_code: string;
      property_id: string;
      room_type_code: string;
      room_type_name: string;
      date: Date;
      allotment: number;
      used: number;
    }[]
  >`
    SELECT c.code AS channel_code, rt.property_id, rt.code AS room_type_code, rt.name AS room_type_name,
           ca.date, ca.allotment, ca.used
      FROM channel_allotments ca
      JOIN channels c ON c.id = ca.channel_id
      JOIN room_types rt ON rt.id = ca.room_type_id
     WHERE ca.used - ca.allotment > ${threshold}
     ORDER BY ca.date, c.code, rt.code
     LIMIT ${limit}`;
  for (const row of rows) {
    found.push({
      condition: 'INVENTORY_OVERBOOKED',
      subject: `allotment:${row.channel_code}:${row.room_type_code}:${day(row.date)}`,
      propertyId: row.property_id,
      detail:
        `Kênh ${row.channel_code} ngày ${day(row.date)} đã dùng ${row.used}/${row.allotment} ` +
        `suất của hạng ${row.room_type_name} — tồn kênh đang âm, cần đóng bán.`,
    });
  }
}

async function degradedChannels(
  db: PrismaClient,
  limit: number,
  threshold: number,
  found: AlertFinding[],
): Promise<void> {
  const rows = await db.$queryRaw<
    { id: string; code: string; sync_status: string; consecutive_sync_failures: number }[]
  >`
    SELECT id, code, sync_status, consecutive_sync_failures
      FROM channels
     WHERE sync_status = 'DEGRADED' OR consecutive_sync_failures >= ${threshold}
     ORDER BY code
     LIMIT ${limit}`;
  for (const row of rows) {
    found.push({
      condition: 'CHANNEL_DEGRADED',
      subject: `channel:${row.id}`,
      propertyId: null,
      detail:
        `Kênh ${row.code} đang ${row.sync_status} sau ${row.consecutive_sync_failures} lần ` +
        'đồng bộ thất bại liên tiếp — tồn/giá trên OTA có thể đã lệch.',
    });
  }
}

async function abnormalLogins(
  db: PrismaClient,
  settings: AlertSettings,
  limit: number,
  found: AlertFinding[],
): Promise<void> {
  const threshold = settings.number('alerts.auth.failedLoginThreshold', 1);
  const users = await db.$queryRaw<
    { id: string; failed_login_count: number; locked_until: Date | null }[]
  >`
    SELECT id, failed_login_count, locked_until
      FROM users
     WHERE failed_login_count >= ${threshold}
        OR (locked_until IS NOT NULL AND locked_until > clock_timestamp())
     ORDER BY failed_login_count DESC, id
     LIMIT ${limit}`;
  for (const user of users) {
    found.push({
      condition: 'ABNORMAL_LOGIN',
      subject: `user:${user.id}`,
      propertyId: null,
      detail:
        `Tài khoản ${user.id} có ${user.failed_login_count} lần đăng nhập sai liên tiếp` +
        `${user.locked_until === null ? '' : ', đang bị khoá tạm thời'} — kiểm tra nguồn truy cập.`,
    });
  }
  const allowed = settings.allowedSurfaces();
  const surfaces = await db.$queryRaw<{ surface: string; attempts: number }[]>`
    SELECT after_json->>'clientSurface' AS surface, count(*)::int AS attempts
      FROM audit_logs
     WHERE action = 'AUTH_LOGIN_FAILURE'
       AND at >= clock_timestamp() - interval '15 minutes'
       AND after_json->>'clientSurface' IS NOT NULL
       AND upper(after_json->>'clientSurface') <> ALL(${allowed}::text[])
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT ${limit}`;
  for (const row of surfaces) {
    found.push({
      condition: 'ABNORMAL_LOGIN',
      subject: `surface:${safeLabel(row.surface)}`,
      propertyId: null,
      detail:
        `${row.attempts} lần đăng nhập thất bại trong 15 phút từ bề mặt lạ ` +
        `"${safeLabel(row.surface)}" — bề mặt hợp lệ: ${allowed.join(', ')}.`,
    });
  }
}

async function refundsOverSla(
  db: PrismaClient,
  limit: number,
  slaDays: number,
  found: AlertFinding[],
): Promise<void> {
  const rows = await db.$queryRaw<
    {
      id: string;
      booking_code: string;
      property_id: string;
      amount: bigint;
      days_waiting: number;
    }[]
  >`
    SELECT rr.id, b.code AS booking_code, b.property_id,
           COALESCE(rr.approved_amount, rr.requested_amount) AS amount,
           floor(EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(rr.decided_at, rr.updated_at)))
                 / 86400)::int AS days_waiting
      FROM refund_requests rr
      JOIN bookings b ON b.id = rr.booking_id
     WHERE rr.status = 'APPROVED' AND rr.paid_at IS NULL
       AND COALESCE(rr.decided_at, rr.updated_at) <= clock_timestamp() - make_interval(days => ${slaDays}::int)
     ORDER BY rr.decided_at, rr.id
     LIMIT ${limit}`;
  for (const row of rows) {
    found.push({
      condition: 'REFUND_OVER_SLA',
      subject: `refund:${row.id}`,
      propertyId: row.property_id,
      detail:
        `Yêu cầu hoàn tiền của đơn ${row.booking_code} (${row.amount} VND) đã duyệt nhưng chưa chi ` +
        `${row.days_waiting} ngày — quá hạn cam kết ${slaDays} ngày (BR-CANCEL-12).`,
    });
  }
}

/** Quét cả năm điều kiện; mỗi điều kiện tối đa `limit` dòng. Không ném khi một điều kiện rỗng. */
export async function collectAlertFindings(
  db: PrismaClient,
  settings: AlertSettings,
  limit: number,
): Promise<readonly AlertFinding[]> {
  const found: AlertFinding[] = [];
  const seen = new Set<string>();
  await roomConflicts(db, limit, found, seen);
  await inventoryOverbook(db, limit, settings.number('alerts.inventory.overbookThreshold'), found);
  await degradedChannels(db, limit, settings.number('alerts.channel.failureThreshold', 1), found);
  await abnormalLogins(db, settings, limit, found);
  await refundsOverSla(db, limit, settings.number('alerts.refund.slaDays', 1), found);
  return found;
}
