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
