/**
 * Giá của **kỳ mới** cho lệnh đổi ngày (BR-RATE-17, ADR-015 §7) — module này **không** có công thức giá
 * thứ hai: mọi con số đến từ báo giá đã chấp nhận hoặc từ chính đường phát hành báo giá của HB-074
 * (dữ kiện qua loader HB-056/198 `loadPricingFacts` rồi engine `@pinehill/domain/pricing`).
 *
 * - Lệnh có `quoteId` ⇒ **tiêu thụ** đúng báo giá đó qua `RateQuoteService.consume` (HB-074, điểm nối
 *   duy nhất: principal, fingerprint, hạn dùng) rồi đối chiếu bản ghi với chính booking + kỳ mới.
 * - Lệnh thiếu `quoteId` ⇒ máy chủ **phát hành báo giá mới** bằng `RateQuoteService.create` trên cùng
 *   dữ kiện và cùng engine (api.md §6.4 "thiếu thì máy chủ tính lại").
 *
 * `consumedInput` của HB-074 chỉ lấy `ratePlanCode`/`promotionCodes` từ bản ghi quote; `childAges` thì
 * không (HB-077 **không** lưu tuổi trẻ em vào booking/snapshot), nên bản ghi được đọc trước để dựng thân
 * lệnh đối chiếu. Bù lại, `assertStay` dưới đây so **mọi trường định danh kỳ mới** với booking: cơ sở,
 * loại phòng, kênh, gói giá, kỳ, số người lớn/trẻ em và số phòng đều phải khớp. Tuổi trẻ em là **khai
 * báo của khách trong báo giá** — đúng mức tin cậy của `POST /bookings` (BR-BOOK-05).
 */
import type { Prisma } from '@prisma/client';
import type { ChannelCode } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import type { Principal } from '../../../common/idempotency/request.js';
import { RateQuoteService } from '../../rate/quotes/service.js';
import type { StoredQuote } from '../../rate/quotes/store.js';

type Tx = Prisma.TransactionClient;

/**
 * Kỳ mới của booking, dựng từ chính hàng `bookings` đã khoá — **không** nhận từ thân lệnh. `ratePlanCode`
 * là mã thô của gói giá đã chốt: hợp đồng `quoteRequestSchema` (HB-074) mới là nơi kiểm nó, còn
 * `channelCode` đã được parse sang enum hợp đồng vì engine tồn (`AvailabilityInput`) yêu cầu enum.
 */
export interface StayRequest {
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly channelCode: ChannelCode;
  readonly ratePlanCode: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly roomCount: number;
}

const mismatched = () =>
  new AppError(
    409,
    'E_RATE_QUOTE_MISMATCH',
    'Báo giá không khớp kỳ mới của đặt phòng; hãy lấy báo giá mới.',
  );

/** Bản ghi quote không khớp booking/kỳ mới ⇒ cùng mã `409 E_RATE_QUOTE_MISMATCH` như HB-074. */
function assertStay(stored: StoredQuote, stay: StayRequest): void {
  const input = stored.input;
  if (
    input.propertyId !== stay.propertyId ||
    input.roomTypeId !== stay.roomTypeId ||
    input.channelCode !== stay.channelCode ||
    input.ratePlanCode !== stay.ratePlanCode ||
    input.checkIn !== stay.checkIn ||
    input.checkOut !== stay.checkOut ||
    input.adults !== stay.adults ||
    input.children !== stay.children ||
    input.roomCount !== stay.roomCount
  )
    throw mismatched();
}

export async function stayPrice(
  tx: Tx,
  quotes: RateQuoteService,
  principal: Principal,
  stay: StayRequest,
  quoteId: string | null,
): Promise<StoredQuote> {
  if (quoteId === null) {
    // Tuổi trẻ em không nằm trên booking (HB-077 chỉ lưu `children`), nên máy chủ không thể tự dựng lại
    // đầu vào giá khi booking có trẻ em: đòi báo giá đã chấp nhận thay vì đoán tuổi.
    if (stay.children > 0)
      throw new AppError(
        400,
        'E_BOOK_MISSING_FIELD',
        'Cần quoteId đã chấp nhận cho kỳ mới khi đặt phòng có trẻ em.',
        undefined,
        [{ field: 'childAges', issue: 'required' }],
      );
    const quote = await quotes.create(tx, principal, stay);
    const stored = await quotes.store.find(quote.quoteId);
    // Bản ghi vừa ghi trong cùng lượt gọi: thiếu ⇒ kho Redis không đọc lại được ⇒ fail closed (503).
    if (stored === null)
      throw new AppError(
        503,
        'E_GEN_SERVICE_UNAVAILABLE',
        'Chưa đọc lại được báo giá vừa phát hành, vui lòng thử lại sau ít phút.',
      );
    return stored;
  }
  const record = await quotes.store.find(quoteId);
  // `consumedInput` (HB-074) đòi thân lệnh có `quoteId`; hai trường `childAges`/`promotionCodes` không
  // có trên `rescheduleRequestSchema` nên lấy từ bản ghi quote để thân lệnh đủ hình dạng fingerprint
  // (tuổi trẻ em là khai báo của khách lúc lấy giá — BR-BOOK-05).
  const stored = await quotes.consume(
    quoteId,
    principal,
    record === null
      ? { ...stay, quoteId }
      : {
          ...stay,
          quoteId,
          childAges: record.input.childAges,
          promotionCodes: record.input.promotionCodes,
        },
  );
  assertStay(stored, stay);
  return stored;
}
