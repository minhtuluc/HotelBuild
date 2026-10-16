import type { Prisma, PrismaClient } from '@prisma/client';
import {
  NOTIFICATION_MAX_RESENDS,
  type ListPage,
  type NotificationResendRequest,
  type NotificationSummary,
} from '@pinehill/contracts';
import type { Clock } from '@pinehill/domain';
import type { AuthorizedActor } from '../../common/actor/authorized-actor.js';
import { AppError } from '../../common/app-error.js';
import { requireProperty, ScopeDeniedError } from '../../common/rbac/scope.js';
import { AuditWriter } from '../../infrastructure/audit/audit-writer.js';
import { maskOperationalText } from '../prop/room-blocks/operational-text.js';
import { forbidden, missing } from '../sys/settings/validation.js';
import { NotificationGateway } from './gateway.js';
import { notificationSelect, project } from './projection.js';
import type { NotificationListInput } from './validation.js';

const readers = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'];

/**
 * BR-SYS-06: lượt gửi lại cách nhau tối thiểu 5 phút. Mốc so là `updated_at` — cột này do trigger
 * `fn_touch_updated_at` của CSDL cập nhật mỗi lần chạm hàng nên đúng bằng "lần thử gần nhất"
 * (chỉ các luồng gửi mới cập nhật hàng này), và mốc so chuẩn là `Clock` tiêm vào.
 */
export const NOTIFICATION_RESEND_INTERVAL_MS = 5 * 60 * 1000;

const RESEND_ACTION = 'NOTIFICATION_RESEND_REQUESTED';

/**
 * Hạn mức gửi lại (BR-SYS-06) ở đây: 400 `E_GEN_VALIDATION_FAILED` — catalogue chưa có mã `E_NOTI_*`
 * nào, còn `E_SYS_REQUEST_IN_PROGRESS` (409) mô tả khoá idempotency đang có chủ, không đúng ngữ
 * nghĩa "đã hết lượt".
 */
function budgetExhausted(): AppError {
  return new AppError(
    400,
    'E_GEN_VALIDATION_FAILED',
    `Thông báo đã dùng hết ${NOTIFICATION_MAX_RESENDS} lượt gửi lại (BR-SYS-06).`,
  );
}

function resendOnCancelled(): AppError {
  return new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Thông báo đã bị huỷ, không thể gửi lại.');
}

function tooEarly(retryAfterSeconds: number): AppError {
  return new AppError(
    429,
    'E_GEN_RATE_LIMITED',
    'Lượt gửi gần nhất chưa đủ 5 phút; hãy chờ rồi gửi lại (BR-SYS-06).',
    retryAfterSeconds,
  );
}

/**
 * UC-NOTI-01/02 (HB-168): danh sách thông báo có che PII + gửi lại có giới hạn ở máy chủ.
 * Quyền đọc/ghi kiểm hai lần (guard `@Permission` ngoài, `permitted` trong service).
 */
export class NotificationsService {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly audit: AuditWriter,
    readonly gateway: NotificationGateway,
  ) {}

  private permitted(actor: AuthorizedActor): void {
    if (!readers.includes(actor.role)) throw forbidden();
  }

  private visible(
    actor: AuthorizedActor,
    input: NotificationListInput,
  ): Prisma.notificationsWhereInput {
    return {
      AND: [
        // Hợp đồng HB-160 không có trạng thái CANCELLED: bản ghi nội bộ, không trả qua API.
        { status: { not: 'CANCELLED' } },
        actor.role === 'OWNER'
          ? {}
          : { bookings: { is: { property_id: { in: [...actor.propertyScope] } } } },
        input.bookingId === undefined ? {} : { booking_id: input.bookingId },
        input.channel === undefined ? {} : { channel: input.channel },
        input.status === undefined ? {} : { status: input.status },
        input.template === undefined ? {} : { template: input.template },
        // `recipient` là PII nên không cho tìm theo; `q` chỉ khớp mẫu thư (không PII).
        input.q === undefined ? {} : { template: { contains: input.q, mode: 'insensitive' } },
        input.from === undefined ? {} : { created_at: { gte: new Date(input.from) } },
        input.to === undefined ? {} : { created_at: { lt: new Date(input.to) } },
      ],
    };
  }

  async list(
    actor: AuthorizedActor,
    input: NotificationListInput,
  ): Promise<ListPage<NotificationSummary>> {
    this.permitted(actor);
    if (actor.role !== 'OWNER' && actor.propertyScope.length === 0)
      return { data: [], meta: { limit: input.limit, nextCursor: null, hasMore: false, total: 0 } };
    const where = this.visible(actor, input);
    return this.db.$transaction(
      async (tx) => {
        // Bộ lọc booking trỏ ra ngoài phạm vi bị từ chối hẳn (403), kể cả khi booking không tồn
        // tại — không lộ sự tồn tại của đối tượng (NFR-SEC-01), cùng cách `guests.search` chốt.
        if (input.bookingId !== undefined) await this.assertInScope(tx, actor, input.bookingId);
        const total = await tx.notifications.count({ where });
        const after = input.cursor === undefined ? undefined : await this.cursor(tx, input.cursor);
        const rows = await tx.notifications.findMany({
          where: after === undefined ? where : { AND: [where, after] },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: input.limit + 1,
          select: notificationSelect,
        });
        const hasMore = rows.length > input.limit;
        const data = (hasMore ? rows.slice(0, input.limit) : rows).map(project);
        return {
          data,
          meta: {
            limit: input.limit,
            hasMore,
            nextCursor: hasMore ? data.at(-1)!.id : null,
            total,
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  /** Cursor là `id`; điều kiện trả về so theo cặp `(created_at, id)` để trang không nhảy bản ghi. */
  private async cursor(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<Prisma.notificationsWhereInput | undefined> {
    const row = await tx.notifications.findUnique({ where: { id }, select: { created_at: true } });
    if (row === null) return undefined;
    return {
      OR: [
        { created_at: { lt: row.created_at } },
        { AND: [{ created_at: row.created_at }, { id: { lt: id } }] },
      ],
    };
  }

  /**
   * Thông báo không có cột cơ sở: nhân viên chỉ thao tác trên bản ghi gắn booking thuộc
   * `propertyScope` (BR-RBAC-02); bản ghi không gắn booking chỉ OWNER thấy (không lộ chéo cơ sở).
   */
  private async assertInScope(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    bookingId: string | null,
  ): Promise<void> {
    if (actor.role === 'OWNER') return;
    if (bookingId === null) throw new ScopeDeniedError();
    const booking = await tx.bookings.findUnique({
      where: { id: bookingId },
      select: { property_id: true },
    });
    if (booking === null) throw new ScopeDeniedError();
    requireProperty(actor, booking.property_id);
  }

  /**
   * Kiểm tra **trước khi cấp claim idempotency** (HB-029): quyền hiện tại + bản ghi còn tồn tại + phạm vi
   * cơ sở hiện tại. Không kiểm hạn mức/mốc 5 phút ở đây — đó là trạng thái nghiệp vụ của handler.
   */
  async authorize(actor: AuthorizedActor, id: string): Promise<void> {
    this.permitted(actor);
    const row = await this.db.notifications.findUnique({
      where: { id },
      select: { booking_id: true },
    });
    if (row === null) throw missing();
    await this.assertInScope(this.db, actor, row.booking_id);
  }

  /**
   * Gửi lại: chặn ở máy chủ (tối đa 3 lượt theo nhật ký kiểm toán — schema đóng băng nên không có
   * cột đếm riêng; cách nhau ≥ 5 phút theo `updated_at`), mở chu kỳ thử mới (`retry_count = 0`,
   * `sent_at`/`error_message` xoá), ghi audit người yêu cầu + lý do rồi phát job.
   *
   * Ghi trong **transaction của interceptor idempotency** (`tx` do `IdempotencyContext` cấp) nên hàng
   * `notifications`, bản ghi audit và bản ghi khoá cùng commit hoặc cùng biến mất (BR-GEN-08).
   */
  async resend(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    id: string,
    input: NotificationResendRequest,
  ): Promise<NotificationSummary> {
    this.permitted(actor);
    await tx.$queryRaw`SELECT id FROM notifications WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.notifications.findUnique({
      where: { id },
      select: { ...notificationSelect, updated_at: true },
    });
    if (row === null) throw missing();
    await this.assertInScope(tx, actor, row.booking_id);
    if (row.status === 'CANCELLED') throw resendOnCancelled();
    const resends = await tx.audit_logs.count({
      where: { entity_type: 'Notification', entity_id: id, action: RESEND_ACTION },
    });
    if (resends >= NOTIFICATION_MAX_RESENDS) throw budgetExhausted();
    const elapsed = this.clock.now().getTime() - row.updated_at.getTime();
    if (elapsed < NOTIFICATION_RESEND_INTERVAL_MS)
      throw tooEarly(Math.ceil((NOTIFICATION_RESEND_INTERVAL_MS - elapsed) / 1000));
    const after = await tx.notifications.update({
      where: { id },
      data: { status: 'PENDING', sent_at: null, error_message: null, retry_count: 0 },
      select: notificationSelect,
    });
    const body = project(after);
    await this.audit.record(tx, {
      actor,
      action: RESEND_ACTION,
      entityType: 'Notification',
      entityId: id,
      beforeJson: project(row),
      afterJson: body,
      /**
       * Cột `reason` không được `AuditWriter` che (HB-009) nên lý do tự do phải qua `maskOperationalText`
       * trước khi lưu (NFR-SEC-03) — cùng cách `crm/guests` và `inv/allotments`. Phản hồi cho khách là
       * `NotificationSummary` (không có trường `reason`) nên nội dung trả về không đổi.
       */
      reason: maskOperationalText(input.reason),
    });
    /**
     * `publish` nằm trong transaction của interceptor nên chạy **trước** commit: rollback sau đây để lại
     * một job mồ côi, worker `notificationSendJob` coi hàng `notifications` không tồn tại là no-op
     * (ADR-004: PostgreSQL là nguồn bền, Redis chỉ tăng tốc). Chưa có outbox HB-130 nên giữ nguyên vị trí
     * phát — **không** dời ra sau commit ở đây.
     */
    await this.gateway.publish(id);
    return body;
  }
}
