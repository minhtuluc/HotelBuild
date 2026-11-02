/**
 * Chi bồi thường qua route riêng (HB-125 AC13, F6-D06): ACCOUNTANT + PIN + `Idempotency-Key`; số tiền
 * lấy từ `RoomMove.compensationAmount` **đã** MANAGER/OWNER duyệt. Ghi `Payment` `COMPENSATION` gắn
 * `room_move_id`, một khoản chi trên một nghĩa vụ PENDING/SUCCEEDED; không dùng quỹ REFUND, không
 * sửa `paidAmount`/Payment gốc, không mở adapter PSP.
 */
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { PIN_PURPOSE_FINANCIAL, requirePinToken } from '../../auth/pin/consume.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { businessConflict, money, notFound, requireProperties, type Tx } from '../support.js';
import {
  compensationPaymentView,
  compensationPaymentsView,
  type CompensationPaymentRow,
} from '../views.js';
import { compensationInput, type CompensationCommand } from './validation.js';

interface MoveFundingRow {
  id: string;
  booking_id: string;
  to_property_id: string | null;
  compensation_amount: bigint;
  status: string;
  approved_by: string | null;
}

function assertMovePayable(move: MoveFundingRow): void {
  if (
    !['APPROVED', 'EXECUTED'].includes(move.status) ||
    move.approved_by === null ||
    move.compensation_amount <= 0n
  )
    throw businessConflict(
      'E_OVER_MOVE_NOT_ALLOWED',
      'Chỉ chi bồi thường đã được MANAGER/OWNER duyệt trên lệnh điều chuyển.',
    );
}

@Injectable()
export class CompensationService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  async pay(
    tx: Tx,
    actor: AuthorizedActor,
    moveId: string,
    body: unknown,
    idempotencyKey: string | undefined,
  ) {
    const command = compensationInput(body);
    const move = await this.lockMoveForUpdate(tx, moveId);
    await this.requireScope(tx, actor, move);
    await this.requireNoLivePayment(tx, move.id);
    assertMovePayable(move);
    const now = this.clock.now();
    await requirePinToken(tx, {
      userId: actor.id,
      token: command.pinToken,
      purpose: PIN_PURPOSE_FINANCIAL,
      bookingId: move.booking_id,
      now,
    });
    const note = command.note === undefined ? null : maskOperationalText(command.note);
    const payment = await this.insertPayment(tx, actor, move, command, idempotencyKey, note, now);
    await this.recordPaymentAudit(tx, actor, move, payment, command, note);
    return compensationPaymentView(payment, move.approved_by);
  }

  private async lockMoveForUpdate(tx: Tx, moveId: string): Promise<MoveFundingRow> {
    const found = await tx.$queryRaw<MoveFundingRow[]>`
      SELECT id, booking_id, to_property_id, compensation_amount, status, approved_by
        FROM room_moves WHERE id=${moveId}::uuid FOR UPDATE`;
    const move = found[0];
    if (move === undefined) throw notFound('Không tìm thấy lệnh điều chuyển.');
    return move;
  }

  private async requireNoLivePayment(tx: Tx, moveId: string): Promise<void> {
    const existing = await tx.$queryRaw<CompensationPaymentRow[]>`
      SELECT * FROM payments
       WHERE room_move_id=${moveId}::uuid AND status IN ('PENDING','SUCCEEDED')
       ORDER BY created_at LIMIT 1 FOR UPDATE`;
    const payment = existing[0];
    if (payment === undefined) return;
    if (payment.status === 'SUCCEEDED')
      throw businessConflict(
        'E_OVER_LIMIT_EXCEEDED',
        'Nghĩa vụ bồi thường này đã được chi; không tạo khoản thứ hai.',
      );
    // Timeout giữ PENDING: tra operation cũ ở GET, không tạo lần chi mới.
    throw businessConflict(
      'E_SYS_REQUEST_IN_PROGRESS',
      'Khoản chi bồi thường đang chờ xác nhận; tra trạng thái trước khi thử lại.',
    );
  }

  private async insertPayment(
    tx: Tx,
    actor: AuthorizedActor,
    move: MoveFundingRow,
    command: CompensationCommand,
    idempotencyKey: string | undefined,
    note: string | null,
    now: Date,
  ): Promise<CompensationPaymentRow> {
    const evidenceNote = JSON.stringify({
      bankReference: command.bankReference ?? null,
      evidenceRefs: command.evidenceRefs ?? [],
      note,
    });
    const rows = await tx.$queryRaw<CompensationPaymentRow[]>`
      INSERT INTO payments(booking_id, type, method, amount, status, idempotency_key, paid_at,
        created_by, note, room_move_id, created_at, updated_at)
      VALUES(${move.booking_id}::uuid, 'COMPENSATION', ${command.method},
        ${move.compensation_amount}, 'SUCCEEDED',
        ${idempotencyKey ?? randomUUID()}, ${now}::timestamptz, ${actor.id}::uuid,
        ${evidenceNote}, ${move.id}::uuid, ${now}::timestamptz, ${now}::timestamptz)
      RETURNING *`;
    return rows[0]!;
  }

  private async recordPaymentAudit(
    tx: Tx,
    actor: AuthorizedActor,
    move: MoveFundingRow,
    payment: CompensationPaymentRow,
    command: CompensationCommand,
    note: string | null,
  ): Promise<void> {
    await this.audit.record(tx, {
      actor,
      action: 'COMPENSATION_PAYMENT',
      entityType: 'Payment',
      entityId: payment.id,
      beforeJson: null,
      afterJson: {
        bookingId: move.booking_id,
        roomMoveId: move.id,
        amount: money(payment.amount),
        method: command.method,
        approvedBy: move.approved_by,
        bankReference: command.bankReference ?? null,
        evidenceRefs: command.evidenceRefs ?? [],
      },
      reason: note,
    });
  }

  async list(actor: AuthorizedActor, moveId: string) {
    const found = await this.db.$queryRaw<MoveFundingRow[]>`
      SELECT id, booking_id, to_property_id, compensation_amount, status, approved_by
        FROM room_moves WHERE id=${moveId}::uuid`;
    const move = found[0];
    if (move === undefined) throw notFound('Không tìm thấy lệnh điều chuyển.');
    await this.requireScope(this.db, actor, move);
    const rows = await this.db.$queryRaw<CompensationPaymentRow[]>`
      SELECT * FROM payments WHERE room_move_id=${move.id}::uuid ORDER BY created_at, id`;
    return compensationPaymentsView(move.id, move.compensation_amount, rows, move.approved_by);
  }

  private async requireScope(
    tx: Tx | PrismaClient,
    actor: AuthorizedActor,
    move: MoveFundingRow,
  ): Promise<void> {
    const booking = await tx.$queryRaw<
      { property_id: string }[]
    >`SELECT property_id FROM bookings WHERE id=${move.booking_id}::uuid`;
    const propertyId = booking[0]?.property_id;
    if (propertyId === undefined)
      throw new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy booking.');
    requireProperties(actor, [propertyId, move.to_property_id]);
  }
}
