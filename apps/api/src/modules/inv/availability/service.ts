import type { Prisma, PrismaClient } from '@prisma/client';
import type { Availability, AvailabilityItem } from '@pinehill/contracts';
import { calculateAvailability } from '@pinehill/domain/inventory';
import type {
  Availability as InventoryAvailability,
  ChannelCode,
} from '@pinehill/domain/inventory';
import { AppError } from '../../../common/app-error.js';
import { loadInventoryFacts } from '../facts/loader.js';
import { missing } from '../allotments/validation.js';
import { stayPrice } from './pricing.js';
import { encodeCursor, nightsBetween } from './validation.js';
import type { AvailabilityInput, RoomTypeCursor } from './validation.js';

/**
 * Kênh dùng khi truy vấn không nêu `channelCode`: kênh trực tiếp ⇒ tồn chung theo BR-INV-01
 * (giống lưới tồn `modules/inv/grid`). Kênh OTA có hạn mức riêng nên phải truyền rõ.
 */
const directChannel: ChannelCode = 'WEB';

/** Thứ tự danh sách là `(code, id)` như lưới tồn; khoá tiếp tục so đúng thứ tự đó. */
function afterCursor(type: RoomTypeRow, cursor: RoomTypeCursor | null): boolean {
  if (cursor === null) return true;
  if (type.code !== cursor.code) return type.code > cursor.code;
  return type.id > cursor.id;
}

/** BR-INV-07: tồn của cả kỳ là **min trên mọi đêm riêng biệt** (`channelAvailability` đã gồm hai tầng tồn). */
function minimumChannelAvailability(availability: InventoryAvailability): number {
  return Math.min(...availability.nightly.map((night) => night.channelAvailability));
}

interface RoomTypeRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly capacity_adults: number;
}

export class AvailabilityService {
  constructor(readonly db: PrismaClient) {}

  /** Chỉ đọc (BR-INV-02: khoá phòng chỉ ở `POST /holds` hoặc `POST /bookings`); một instant dùng chung cả cơ sở. */
  async search(input: AvailabilityInput): Promise<Availability> {
    return this.db.$transaction((tx) => this.searchIn(tx, input), {
      isolationLevel: 'RepeatableRead',
    });
  }

  private async searchIn(
    tx: Prisma.TransactionClient,
    input: AvailabilityInput,
  ): Promise<Availability> {
    const property = await tx.properties.findUnique({
      where: { id: input.propertyId },
      select: { id: true },
    });
    if (!property) throw missing();
    const types = await this.roomTypes(tx, input);
    const now = await this.instant(tx);
    const channel: ChannelCode = input.channelCode ?? directChannel;
    const channelActive = await this.channelActive(tx, input.channelCode);
    // BR-BOOK-04: sức chứa tối đa = `capacityAdults × roomCount`; loại quá nhỏ không phải kết quả hợp lệ.
    const eligible = types.filter((type) => type.capacity_adults * input.roomCount >= input.adults);
    if (input.roomTypeId !== undefined && eligible.length === 0)
      throw new AppError(422, 'E_BOOK_OVER_CAPACITY', 'Số khách vượt sức chứa của loại phòng.');
    const page = eligible
      .filter((type) => afterCursor(type, input.after))
      .slice(0, input.limit + 1);
    const selected = page.slice(0, input.limit);
    const data: AvailabilityItem[] = [];
    for (const type of selected)
      data.push(await this.item(tx, input, type, now, channel, channelActive));
    const last = selected.at(-1);
    const hasMore = page.length > input.limit;
    return {
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights: nightsBetween(input.checkIn, input.checkOut),
      ...(input.channelCode === undefined ? {} : { channelCode: input.channelCode }),
      data,
      meta: {
        limit: input.limit,
        nextCursor: hasMore && last !== undefined ? encodeCursor(last.code, last.id) : null,
        hasMore,
        total: eligible.length,
      },
    };
  }

  /** Cơ sở chưa có loại phòng, hoặc loại phòng không thuộc cơ sở đang hỏi: không có gì để trả (như lưới tồn). */
  private async roomTypes(
    tx: Prisma.TransactionClient,
    input: AvailabilityInput,
  ): Promise<RoomTypeRow[]> {
    const types = await tx.room_types.findMany({
      where: {
        property_id: input.propertyId,
        ...(input.roomTypeId === undefined ? {} : { id: input.roomTypeId }),
      },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true, name: true, capacity_adults: true },
    });
    if (types.length === 0) throw missing();
    return types;
  }

  private async instant(tx: Prisma.TransactionClient): Promise<Date> {
    const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    return rows[0]!.now;
  }

  /** Kênh không hoạt động (hoặc không tồn tại) đóng bán như lưới tồn đang làm. */
  private async channelActive(
    tx: Prisma.TransactionClient,
    channelCode: ChannelCode | undefined,
  ): Promise<boolean> {
    if (channelCode === undefined) return true;
    const channel = await tx.channels.findUnique({
      where: { code: channelCode },
      select: { status: true },
    });
    return channel?.status === 'ACTIVE';
  }

  private async item(
    tx: Prisma.TransactionClient,
    input: AvailabilityInput,
    type: RoomTypeRow,
    now: Date,
    channelCode: ChannelCode,
    channelActive: boolean,
  ): Promise<AvailabilityItem> {
    const facts = await loadInventoryFacts(tx, {
      propertyId: input.propertyId,
      roomTypeId: type.id,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      channelCode,
    });
    const result = calculateAvailability({ ...facts, now });
    const availability = result.ok
      ? result.value
      : result.error.code === 'E_INV_NO_AVAILABILITY'
        ? result.error.availability
        : null;
    if (availability === null) throw new Error('Invalid inventory facts');
    const availableCount = channelActive ? minimumChannelAvailability(availability) : 0;
    // BR-INV-07: chỉ khi khách yêu cầu rõ một loại phòng thì thiếu phòng là lỗi; tìm cả cơ sở vẫn
    // trả về loại đã hết chỗ với `soldOut = true` để kết quả không phụ thuộc việc lọc.
    if (input.roomTypeId !== undefined && availableCount < input.roomCount)
      throw new AppError(
        409,
        'E_INV_NO_AVAILABILITY',
        'Kỳ lưu trú không còn đủ phòng cho số phòng đã chọn.',
      );
    return {
      propertyId: input.propertyId,
      roomTypeId: type.id,
      roomTypeCode: type.code,
      roomTypeName: type.name,
      capacityAdults: type.capacity_adults,
      availableCount,
      soldOut: availableCount === 0,
      ...(await stayPrice(tx, {
        propertyId: input.propertyId,
        roomTypeId: type.id,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        // Kênh ngừng bán/không tồn tại không có giá riêng để engine tính ⇒ giữ "giá từ" theo kênh
        // trực tiếp, còn tồn của kênh đó vẫn là 0 (kết quả vẫn nói đúng: kênh này không bán được).
        channelCode: channelActive ? channelCode : directChannel,
        // Cùng một mốc cho mọi loại phòng trong phản hồi (xem `StayPriceQuery.now`).
        now,
      })),
    };
  }
}
