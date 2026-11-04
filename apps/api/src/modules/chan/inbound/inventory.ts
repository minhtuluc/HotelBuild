/**
 * Tồn kho của một sự kiện OTA (HB-032/ADR-014): chạy **sau** khi đã lấy khoá `properties → room_types
 * → rooms`, dùng đúng engine `@pinehill/domain/inventory` mà `planHold` (HB-076) dùng.
 *
 * Khác `planHold`: OTA đã bán nên **không** từ chối khi hết chỗ (BR-CHAN-08). Ở đây chỉ trả về
 * - `units`: đơn vị bán thật sự trống **cả kỳ** (để gán `room_assignments`);
 * - `shortage`: số đơn vị không gán được — phần còn lại tồn tại dưới dạng demand chưa gán (AC5).
 *
 * `channel_allotments.used` được cộng/trừ **chỉ trên cấu hình đã có**: hạn mức là cấu hình của
 * HB-035, còn quyết định bán vượt là của BR-CHAN-08. Không tự tạo dòng hạn mức mới từ đường áp inbox.
 */
import { Prisma } from '@prisma/client';
import { calculateAvailability } from '@pinehill/domain/inventory';
import type { ChannelCode, UnitIdentity } from '@pinehill/domain/inventory';
import { loadInventoryFacts } from '../../inv/facts/loader.js';

type Tx = Prisma.TransactionClient;

export interface InventoryPlan {
  /** Đơn vị bán gán được cho **toàn kỳ**, tối đa `roomCount`. */
  readonly units: readonly UnitIdentity[];
  /** `roomCount − units.length`: demand chưa gán, cũng là cơ sở cờ `oversold` (AC3/AC5). */
  readonly shortage: number;
}

export interface InventoryQuery {
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly channelCode: ChannelCode;
  readonly roomCount: number;
}

export async function planUnits(tx: Tx, query: InventoryQuery): Promise<InventoryPlan> {
  const facts = await loadInventoryFacts(tx, query);
  const result = calculateAvailability({ ...facts, now: facts.now });
  if (result.ok) return planOf(result.value.continuousUnits, query.roomCount);
  // Dữ kiện do loader của mình dựng: `E_INV_INVALID_INPUT` là lỗi lập trình, không phải lỗi sự kiện.
  if (result.error.code === 'E_INV_INVALID_INPUT') throw new Error('Invalid inventory facts');
  return planOf(result.error.availability.continuousUnits, query.roomCount);
}

function planOf(continuousUnits: readonly UnitIdentity[], roomCount: number): InventoryPlan {
  const units = continuousUnits.slice(0, roomCount);
  return { units, shortage: Math.max(0, roomCount - units.length) };
}

/** Ghi nhận mức tiêu thụ hạn mức của **một đêm**; `delta` âm khi huỷ/đổi kỳ (AC2/AC7/AC8). */
export async function trackUsage(
  tx: Tx,
  input: {
    readonly channelId: string;
    readonly roomTypeId: string;
    readonly nights: readonly string[];
    readonly delta: number;
    readonly now: Date;
  },
): Promise<void> {
  for (const night of input.nights) {
    await tx.$executeRaw`
      UPDATE channel_allotments
         SET used = GREATEST(0, used + ${input.delta}), updated_at = ${input.now}
       WHERE channel_id = ${input.channelId}::uuid
         AND room_type_id = ${input.roomTypeId}::uuid
         AND date = ${night}::date`;
  }
}

export interface AllotmentState {
  readonly id: string;
  readonly allotment: number;
  readonly used: number;
  readonly closed: boolean;
}

/** Cấu hình hạn mức của các đêm trong kỳ (chỉ dòng đã có — nguồn của cảnh báo BR-CHAN-08). */
export function allotmentStates(
  tx: Tx,
  input: {
    readonly channelId: string;
    readonly roomTypeId: string;
    readonly nights: readonly string[];
  },
): Promise<AllotmentState[]> {
  if (input.nights.length === 0) return Promise.resolve([]);
  return tx.$queryRaw<
    { id: string; allotment: number; used: number; closed: boolean }[]
  >`SELECT id, allotment, used, is_closed AS closed
        FROM channel_allotments
       WHERE channel_id = ${input.channelId}::uuid
         AND room_type_id = ${input.roomTypeId}::uuid
         AND date::text IN (${Prisma.join(input.nights)})`.then((rows) =>
    rows.map((row) => ({
      id: row.id,
      allotment: row.allotment,
      used: row.used,
      closed: row.closed,
    })),
  );
}
