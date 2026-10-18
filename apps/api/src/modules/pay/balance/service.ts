/**
 * `GET /bookings/{bookingId}/balance` (HB-096; api.md §2.6, §3.5; BR-PAY-02).
 *
 * Số dư đọc từ **projection sổ cái** (`BookingLedger.read`, HB-093) — không đọc trực tiếp các cột
 * `paid_amount`/`balance_due` có thể lệch ngoài đường huỷ (TD-18). Tách rõ đã thu / còn nợ / hoàn đang
 * giữ hạn mức; `onlineDepositAmount` theo công thức api.md §3.5 = `max(0, depositAmount − Σ DEPOSIT
 * đã thu)`, `null` khi không được khởi tạo (trạng thái kết thúc, hold hết hạn, hoặc đã đủ cọc).
 *
 * Khi HB-094 ghép `pay/online/projection.ts::obligation`, thay nhánh tính cọc bằng hàm đó và ghi PR.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { bookingBalanceSchema } from '@pinehill/contracts';
import type { BookingBalance } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import type { BookingCaller } from '../../book/bookings/principal.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import type { DatabaseClient } from '../../../infrastructure/prisma/prisma.module.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { BookingLedger } from '../ledger/service.js';

type Tx = Prisma.TransactionClient;

/** Trạng thái còn cho khởi tạo thanh toán cọc trực tuyến (api.md §3.5). */
const ONLINE_DEPOSIT_STATES: readonly string[] = ['DRAFT', 'HELD', 'PENDING_PAYMENT'];

const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
const outOfScope = () =>
  new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Bạn không được truy cập dữ liệu của cơ sở này.');
const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');

export interface BalanceRow {
  readonly id: string;
  readonly guest_id: string;
  readonly property_id: string;
  readonly status: string;
  readonly total_amount: bigint;
  readonly deposit_amount: bigint;
  readonly hold_expires_at: Date | null;
}

@Injectable()
export class BookingBalanceService {
  private readonly ledger: BookingLedger;
  constructor(
    @Inject(PRISMA) private readonly db: DatabaseClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PermissionRegistry) private readonly permissions: PermissionRegistry,
  ) {
    this.ledger = new BookingLedger(clock);
  }

  async read(caller: BookingCaller, bookingId: string): Promise<BookingBalance> {
    const booking = await this.db.bookings.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        guest_id: true,
        property_id: true,
        status: true,
        total_amount: true,
        deposit_amount: true,
        hold_expires_at: true,
      },
    });
    if (booking === null) throw missing();
    requireRead(this.permissions, caller, booking);
    const projection = await this.db.$transaction((tx: Tx) => this.ledger.read(tx, booking.id));
    const online = await this.onlineDeposit(caller, booking);
    return bookingBalanceSchema.parse({
      bookingId: booking.id,
      currency: 'VND',
      totalAmount: Number(booking.total_amount),
      paidAmount: Number(projection.paidAmount),
      refundedAmount: Number(projection.refundedAmount),
      reservedRefundAmount: Number(projection.refundReserved),
      balanceDue: Number(projection.balanceDue),
      onlineDepositAmount: online === null ? null : Number(online),
    });
  }

  /** Cọc còn thiếu cho khởi tạo trực tuyến; `null` khi không được phép khởi tạo (api.md §3.5). */
  private async onlineDeposit(caller: BookingCaller, booking: BalanceRow): Promise<bigint | null> {
    if (caller.type === 'USER') return null; // tuyến khách: nhân viên dùng đường thu tại quầy
    if (!ONLINE_DEPOSIT_STATES.includes(booking.status)) return null;
    const now = this.clock.now();
    if (booking.hold_expires_at !== null && booking.hold_expires_at.getTime() <= now.getTime())
      return null;
    const collected = await this.db.payments.aggregate({
      where: { booking_id: booking.id, status: 'SUCCEEDED', type: 'DEPOSIT' },
      _sum: { amount: true },
    });
    const paidDeposit = collected._sum.amount ?? 0n;
    const shortfall = booking.deposit_amount - paidDeposit;
    return shortfall > 0n ? shortfall : null;
  }
}

/** Quyền đọc `bookings.balance` + phạm vi cơ sở; khách chỉ booking của mình (mask 404 như HB-077). */
function requireRead(
  permissions: PermissionRegistry,
  caller: BookingCaller,
  target: BalanceRow,
): void {
  if (caller.type === 'GUEST') {
    if (caller.id !== target.guest_id) throw missing();
    return;
  }
  if (!permissions.allows(caller.role, 'bookings.balance')) throw forbidden();
  if (caller.role === 'OWNER') return;
  if (caller.role === 'SYSADMIN' || !caller.propertyScope.includes(target.property_id))
    throw outOfScope();
}
