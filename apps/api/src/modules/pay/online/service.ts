/**
 * Use case thanh toán trực tuyến (HB-094; UC-PAY-02, FR-PAY-03/04; api.md §2.6, §3.5).
 *
 * `POST /payments/online` — thứ tự thi hành:
 * 1. khoá booking theo **đúng thứ tự ADR-014** qua `lockBooking` của HB-077 (`bookings → properties →
 *    room_types`) rồi `BookingLedger.read` (HB-093) khoá `bookings → payments → refund_requests`; hàng
 *    idempotency đã được `IdempotencyStore` khoá trước đó;
 * 2. kiểm quyền trên chính booking **sau** khi khoá (khách chỉ đơn của mình ⇒ `404`; nhân viên cần
 *    `payments.online` + phạm vi cơ sở);
 * 3. đọc **giờ CSDL** và sổ cái, so `amount` với nghĩa vụ hiện tại (`projection.obligation`); lệch ⇒
 *    `422 E_PAY_AMOUNT_MISMATCH` — không tự tính tiền, không tin tham số khách gửi (BR-PAY-01/02);
 * 4. mở phiên cổng (adapter dựng URL đã ký, **không** gọi mạng) rồi ghi `payments` `PENDING` + audit
 *    trong **cùng** transaction của lệnh: cùng commit hoặc cùng rollback (BR-GEN-07, AC3).
 *
 * `GET /payments/{id}/status` — chỉ đọc CSDL, **không** gọi cổng mỗi lần poll (AC3/BR-PAY-05): kết quả
 * cuối do PSP xác nhận qua webhook (HB-095), client không tự đánh dấu đã trả.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma as PrismaTypes, PrismaClient } from '@prisma/client';
import type { Payment, PaymentStatusView } from '@pinehill/contracts';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { lockBooking } from '../../book/bookings/lock.js';
import type { BookingCaller } from '../../book/bookings/principal.js';
import { inventoryError } from '../../prop/room-blocks/locks.js';
import { BookingLedger } from '../ledger/service.js';
import { PAYMENT_GATEWAYS } from '../psp/gateways.js';
import type { PaymentGateways } from '../psp/gateways.js';
import type { PaymentGatewayAdapter, PspInit } from '../psp/port.js';
import { ipnUrl } from '../psp/settings.js';
import { requireOnlinePayment } from './principal.js';
import {
  ENDED_BOOKING_STATUSES,
  ORDER_REF_PREFIX,
  obligation,
  projectPayment,
  projectStatus,
  statusSelect,
} from './projection.js';
import {
  amountMismatch,
  gatewayError,
  invalidState,
  missing,
  requireAllowedReturnUrl,
  type OnlinePaymentInput,
} from './validation.js';
import { auditOnlinePayment, insertOnlinePayment } from './writes.js';

type Tx = PrismaTypes.TransactionClient;

@Injectable()
export class OnlinePaymentsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(BookingLedger) private readonly ledger: BookingLedger,
    @Inject(PAYMENT_GATEWAYS) private readonly gateways: PaymentGateways,
    @Inject(PermissionRegistry) private readonly permissions: PermissionRegistry,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  /** AC1–AC3: một Payment `PENDING` đúng nghĩa vụ, `orderRef` do máy chủ sinh, audit cùng transaction. */
  async init(
    tx: Tx,
    caller: BookingCaller,
    input: OnlinePaymentInput,
    idempotencyKey: string,
  ): Promise<Payment> {
    try {
      // F4: `returnUrl` chỉ được trỏ về origin đã khai (danh sách trắng / gốc callback), kiểm trước CSDL.
      requireAllowedReturnUrl(this.gateways.settings, input.returnUrl);
      const booking = await lockBooking(tx, input.bookingId);
      requireOnlinePayment(this.permissions, caller, {
        guestId: booking.guestId,
        propertyId: booking.propertyId,
      });
      if (ENDED_BOOKING_STATUSES[booking.status] === true)
        throw invalidState('Đặt phòng đã kết thúc; không khởi tạo thanh toán trực tuyến.');
      // Giờ CSDL là nguồn thời gian của tiền và hold (ADR-014, BR-BOOK-18), không phải đồng hồ tiến trình.
      const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
      const projection = await this.ledger.read(tx, input.bookingId);
      const due = obligation(
        {
          status: booking.status,
          depositAmount: booking.depositAmount,
          // Tổng thu **đúng loại** (BR-PAY-02/ADR-016): khoản PENALTY/EXTRA_SERVICE thu song song không
          // được hạ obligation cọc đi — bù trừ toàn cục bị cấm (api.md §3.5, csdl.md §3).
          depositPaid: projection.paidByType['DEPOSIT'] ?? 0n,
          balanceDue: projection.balanceDue,
          holdExpiresAt: booking.holdExpiresAt,
          now,
        },
        input.type,
      );
      if (input.amount !== due) throw amountMismatch();
      const write = {
        bookingId: input.bookingId,
        propertyId: booking.propertyId,
        type: input.type,
        method: input.method,
        amount: input.amount,
        idempotencyKey,
        caller,
        now,
      };
      const row = await insertOnlinePayment(tx, write);
      // F7: `orderRef` do **máy chủ** sinh từ định danh hàng `payments` (`PH-<uuid>`), không phải khoá khách
      // gửi ⇒ HB-095 bỏ tiền tố `PH-` rồi tra theo khoá chính; duy nhất tuyệt đối, không đổi DDL.
      const orderRef = `${ORDER_REF_PREFIX}${row.id}`;
      const adapter = this.gateways.for(input.method);
      const session = this.openSession(adapter, input, now, caller.ip, orderRef);
      await auditOnlinePayment(tx, this.audit, write, { id: row.id, orderRef });
      return projectPayment(row, session.paymentUrl);
    } catch (error) {
      // Xung đột khoá/tuần tự (40P01/40001/55P03, P2034) ⇒ chạy lại **toàn bộ** transaction theo ADR-014.
      inventoryError(error);
    }
  }

  /** AC3: trạng thái đọc từ CSDL; khách khác ⇒ `404` (không lộ tài nguyên người khác). */
  async status(caller: BookingCaller, paymentId: string): Promise<PaymentStatusView> {
    const row = await this.db.payments.findUnique({
      where: { id: paymentId },
      select: statusSelect,
    });
    if (row === null) throw missing();
    requireOnlinePayment(this.permissions, caller, {
      guestId: row.bookings.guest_id,
      propertyId: row.bookings.property_id,
    });
    return projectStatus(row);
  }

  /**
   * Phiên cổng: adapter **chỉ** dựng dữ liệu chuyển hướng (không I/O mạng) nên chạy được trong
   * transaction; lỗi cấu hình/định dạng cổng đổi thành `502 E_PAY_GATEWAY_ERROR` (api.md §4.3) thay vì
   * lộ chi tiết nội bộ. Cổng thật cần gọi mạng thì phải đi qua outbox (§5.3 mục 1) — ngoài phạm vi HB-094.
   */
  private openSession(
    adapter: PaymentGatewayAdapter,
    input: OnlinePaymentInput,
    now: Date,
    ip: string | null,
    orderRef: string,
  ): PspInit {
    try {
      return adapter.init({
        orderRef,
        amount: input.amount,
        type: input.type,
        returnUrl: input.returnUrl,
        ipnUrl: ipnUrl(this.gateways.settings, input.method),
        now,
        ip,
      });
    } catch {
      throw gatewayError();
    }
  }
}
