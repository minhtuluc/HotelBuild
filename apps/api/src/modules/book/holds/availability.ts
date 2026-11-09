/**
 * Kiểm tồn cho một hold bằng **engine HB-032** (`@pinehill/domain/inventory`) trên dữ kiện CSDL của
 * `loadInventoryFacts` — chạy **sau** khi đã lấy khoá ADR-014 (`lock.ts`), không tính lại giá và không
 * đọc Redis (nguồn chân lý tồn là `bookings.hold_expires_at` + `room_assignments`, BR-INV-04).
 *
 * Hai phép kiểm phải cùng đạt mới được bán thường (ADR-014, BR-INV-01/02/07):
 * 1. **tồn thương mại của kênh** mọi đêm ≥ `roomCount` — `min(channelAvailability)` trên cả kỳ;
 * 2. **phương án gán thật** cho toàn kỳ ≥ `roomCount` đơn vị bán liên tục (`continuousUnits`) — tồn đủ
 *    từng đêm là điều kiện cần, chưa đủ (BR-BOOK-10).
 * Engine đã tự trả `E_INV_NO_AVAILABILITY` khi có đêm hết chỗ; ở đây siết thêm mức `roomCount`.
 */
import type { Prisma as PrismaTypes } from '@prisma/client';
import { calculateAvailability } from '@pinehill/domain/inventory';
import type { AvailabilityInput, UnitIdentity } from '@pinehill/domain/inventory';
import { loadInventoryFacts } from '../../inv/facts/loader.js';
import { AppError } from '../../../common/app-error.js';
import { noAvailability } from './validation.js';

export interface HoldPlan {
  /** Dữ kiện đã đọc sau khoá; `facts.now` là **giờ CSDL** dùng cho hạn hold (BR-BOOK-07). */
  readonly facts: AvailabilityInput;
  /** Đúng `roomCount` đơn vị bán gán được cho cả kỳ, theo thứ tự `rooms.id` của dữ kiện. */
  readonly units: readonly UnitIdentity[];
}

export async function planHold(
  tx: PrismaTypes.TransactionClient,
  input: {
    readonly propertyId: string;
    readonly roomTypeId: string;
    readonly checkIn: string;
    readonly checkOut: string;
    readonly channelCode: AvailabilityInput['channelCode'];
    readonly roomCount: number;
  },
): Promise<HoldPlan> {
  const facts = await loadInventoryFacts(tx, {
    propertyId: input.propertyId,
    roomTypeId: input.roomTypeId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    channelCode: input.channelCode,
  });
  const result = calculateAvailability({ ...facts, now: facts.now });
  if (!result.ok) {
    // Dữ kiện do loader của mình dựng: `E_INV_INVALID_INPUT` là lỗi lập trình, không phải lỗi người gọi.
    if (result.error.code === 'E_INV_NO_AVAILABILITY') throw noAvailability();
    throw new Error('Invalid inventory facts');
  }
  const nightly = result.value.nightly;
  const channelMinimum = Math.min(...nightly.map((night) => night.channelAvailability));
  if (channelMinimum < input.roomCount || result.value.continuousUnits.length < input.roomCount)
    throw noAvailability();
  return { facts, units: result.value.continuousUnits.slice(0, input.roomCount) };
}

type PlanInput = Parameters<typeof planHold>[1] & {
  readonly adults: number;
  readonly children: number;
};

/**
 * Chặn sớm **trước khoá ADR-014** (HB-225, TD-17): đọc `READ COMMITTED` không khoá. Nếu kỳ đã hết
 * chỗ thì trả `409 E_INV_NO_AVAILABILITY` ngay, không xếp hàng trên khoá `properties`.
 *
 * Thiếu bước này, khi một đơn vị cuối có hàng trăm lệnh cùng giành, mỗi lệnh thua vẫn giữ một
 * connection để chờ khoá rồi kiểm tồn tuần tự. Hàng đợi vượt `timeout` 10 giây của transaction ⇒
 * 500, client thử lại ⇒ hàng đợi không bao giờ rút (sụp đổ "metastable" của AC4 HB-076 trên CI).
 *
 * Chỉ kết luận **hết chỗ**. Một trạng thái đã commit nói "không đủ" thì trả lời đó đúng ở thời điểm
 * đọc. Kết quả "còn chỗ" vẫn phải xác nhận lại sau khoá bằng `planHold`. Các trường hợp mà đường
 * có khoá trả mã khác ở bước trước (loại phòng lạ, vượt sức chứa) không kết luận ở đây, để giữ
 * nguyên thứ tự mã lỗi.
 */
export async function soldOutBeforeLock(
  tx: PrismaTypes.TransactionClient,
  input: PlanInput,
): Promise<boolean> {
  const type = await tx.room_types.findUnique({
    where: { id: input.roomTypeId },
    select: { property_id: true, capacity_adults: true },
  });
  if (type === null || type.property_id !== input.propertyId) return false;
  if (type.capacity_adults * input.roomCount < input.adults + input.children) return false;
  try {
    await planHold(tx, input);
    return false;
  } catch (error) {
    if (error instanceof AppError && error.code === 'E_INV_NO_AVAILABILITY') return true;
    throw error;
  }
}
