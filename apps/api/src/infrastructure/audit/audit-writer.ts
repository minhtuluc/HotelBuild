import { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { ActorContext } from '../../common/actor/actor-context.js';

export interface AuditEntry {
  readonly actor: ActorContext;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly beforeJson: Prisma.InputJsonValue | null;
  readonly afterJson: Prisma.InputJsonValue | null;
  readonly reason: string | null;
}

/**
 * Trường bị che khi ghi nhật ký (NFR-SEC-03) — **một chỗ** cho mọi bảng nghiệp vụ.
 * Khớp theo tên khoá ở mọi độ sâu, cả camelCase lẫn snake_case mà máy chủ có thể trả.
 */
const MASKED_KEYS: Readonly<Record<string, true>> = {
  password: true,
  passwordHash: true,
  password_hash: true,
  phone: true,
  phoneNumber: true,
  phone_number: true,
  email: true,
  idNumber: true,
  id_number: true,
};

/** Giữ 4 ký tự cuối để tra soát, phần còn lại thay bằng `****` (chuỗi ≤ 4 ký tự che toàn bộ). */
function maskString(value: string): string {
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function maskField(value: unknown): Prisma.InputJsonValue | null {
  return typeof value === 'string' ? maskString(value) : maskJson(value);
}

/**
 * Che PII theo cấu trúc, trả về **bản sao** mới: đầu vào không bị sửa (caller có thể còn dùng lại
 * chính object đó). Giá trị ngoài JSON (Date/BigInt/undefined) không thuộc hợp đồng snapshot → `null`.
 */
function maskJson(value: unknown): Prisma.InputJsonValue | null {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => maskJson(item));
  if (!isPlainObject(value)) return null;
  const masked: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, item] of Object.entries(value)) {
    masked[key] = MASKED_KEYS[key] === true ? maskField(item) : maskJson(item);
  }
  return masked;
}

/** Snapshot đã che PII để ghi vào `audit_logs.before_json`/`after_json`. */
export function maskSnapshot(snapshot: Prisma.InputJsonValue | null): Prisma.InputJsonValue | null {
  return maskJson(snapshot);
}

/** Cột JSON nullable của Prisma không nhận `null` trực tiếp: snapshot rỗng ghi bằng `DbNull` (SQL NULL). */
function snapshotColumn(
  snapshot: Prisma.InputJsonValue | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const masked = maskJson(snapshot);
  return masked === null ? Prisma.DbNull : masked;
}

/**
 * `chain_seq`/`prev_hash`/`row_hash` do trigger `trg_audit_logs_hash_chain` cấp **sau** khi khoá chuỗi
 * (csdl §8.1 mục 3); hai cột NOT NULL nên vẫn phải gửi giá trị chỗ giữ, trigger ghi đè trước khi kiểm ràng buộc.
 */
const CHAIN_SEQ_PLACEHOLDER = 0n;
const ROW_HASH_PLACEHOLDER = 'pending-database-trigger';

/**
 * Ghi `audit_logs` **trong transaction của caller** (BR-SYS-01): mọi lỗi ghi nhật ký làm rollback cả
 * giao dịch nghiệp vụ, và writer không tự mở/commit transaction. Thời gian lấy từ `Clock` tiêm vào.
 */
export class AuditWriter {
  constructor(readonly clock: Clock) {}

  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.audit_logs.create({
      data: {
        chain_seq: CHAIN_SEQ_PLACEHOLDER,
        row_hash: ROW_HASH_PLACEHOLDER,
        actor_id: entry.actor.id,
        actor_role: entry.actor.role,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        before_json: snapshotColumn(entry.beforeJson),
        after_json: snapshotColumn(entry.afterJson),
        reason: entry.reason,
        ip_address: entry.actor.ip,
        at: this.clock.now(),
      },
    });
  }
}
