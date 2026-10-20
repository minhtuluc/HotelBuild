/**
 * Điều phối walk-in (HB-151; UC-BOOK-02, FR-BOOK-02; api.md §2.5, §3.2).
 *
 * Một lệnh duy nhất đi qua **đúng** các use case F4 đã có, trong **một** transaction của
 * `IdempotencyStore` (HB-029):
 * 1. **kênh theo cấu hình**: đọc `channels` theo mã `WALKIN`; không hard-code id kênh. Kênh thiếu ⇒
 *    404, `status = INACTIVE` ⇒ `409 E_BOOK_INVALID_STATE` (api.md §2.5, BR-BOOK-07);
 * 2. **quote** — `RateQuoteService.create` (HB-074): điểm nối duy nhất của luật giá/fingerprint/hạn,
 *    không tính lại giá, không mở giá OTA (kênh `WALKIN` chỉ cho phiên nhân viên);
 * 3. **hold/booking** — `BookingsService.create` (HB-077): khoá tồn theo ADR-014, tiêu thụ quote, kiểm
 *    sức chứa/trùng lặp, ghi booking + assignment + `PriceSnapshot` + `booking_charges` + audit/outbox.
 *    Trạng thái do **cấu hình kênh** quyết: `holdMinutes = 0` (WALKIN) ⇒ bỏ qua `HELD`, dùng
 *    `PENDING_PAYMENT` hạn 15 phút (BR-BOOK-07 + Q-13). Vì vậy coordinator **không** gọi
 *    `HoldsService`: api.md §3.4 trả `409 E_BOOK_INVALID_STATE` cho kênh `holdMinutes = 0`, và
 *    `POST /holds` chỉ dành cho phiên khách (`book/holds/principal.ts`); nhân viên dùng luồng đặt phòng.
 *
 * **Cọc** không nằm trong transaction này: `pinToken` bị ràng buộc `booking_id` (HB-015
 * `requirePinToken`), mà booking chỉ tồn tại sau bước 3 — nên bước thu cọc là `POST /payments` (HB-096)
 * của chính booking vừa trả về, với `pinToken` mở khoá cho đúng `bookingId`. Cả hai bước đều idempotent
 * theo khoá riêng của chúng; nới ràng buộc PIN để gộp cọc vào cùng lệnh là thay đổi ngữ nghĩa bảo mật
 * (ngoài phạm vi ticket này).
 *
 * Lưu ý: mọi ảnh hưởng của lệnh nằm trong transaction idempotency của lần gọi **đầu**; lần gọi lại cùng
 * `Idempotency-Key` phát lại nguyên phản hồi, không tạo quote/booking thứ hai.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { channelCodeSchema } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { RateQuoteService } from '../../rate/quotes/service.js';
import { BookingsService } from '../bookings/service.js';
import type { BookingCaller } from '../bookings/principal.js';
import { channelInactive, missing, WALK_IN_CHANNEL } from './validation.js';
import type { WalkInInput, WalkInResult } from './validation.js';
import { bookingRequestBody, quoteRequestBody } from './validation.js';

type Tx = Prisma.TransactionClient;

@Injectable()
export class WalkInService {
  constructor(
    @Inject(RateQuoteService) private readonly quotes: RateQuoteService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  async create(tx: Tx, actor: AuthorizedActor, input: WalkInInput): Promise<WalkInResult> {
    const channel = await tx.channels.findUnique({
      where: { code: WALK_IN_CHANNEL },
      select: { code: true, status: true },
    });
    if (channel === null) throw missing();
    if (channel.status !== 'ACTIVE') throw channelInactive();
    const channelCode = channelCodeSchema.parse(channel.code);

    // Bước 1 — báo giá bằng engine F4; `tx` giữ nguyên transaction idempotency của cả lệnh.
    const quote = await this.quotes.create(
      tx,
      Object.freeze({ type: 'USER' as const, id: actor.id }),
      quoteRequestBody(input, channelCode),
    );
    // Bước 2 — đặt phòng: khoá tồn/tiêu thụ quote/snapshot do HB-077 quyết, không chép lại ở đây.
    const caller: BookingCaller = Object.freeze({
      type: 'USER' as const,
      id: actor.id,
      role: actor.role,
      propertyScope: actor.propertyScope,
      ip: actor.ip,
      correlationId: actor.correlationId,
      principal: Object.freeze({ type: 'USER' as const, id: actor.id }),
    });
    const written = await this.bookings.create(
      tx,
      caller,
      bookingRequestBody(input, quote.quoteId, channelCode),
    );
    return { created: written.created, quote, booking: written.booking };
  }
}
