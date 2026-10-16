import { seasonSummarySchema } from '@pinehill/contracts';
import type { SeasonSummary } from '@pinehill/contracts';
import type { seasons } from '@prisma/client';
import { dateOnly } from '../calendar/support.js';

/** Mùa của `GET /seasons`; hợp đồng yêu cầu `propertyId` khác rỗng nên mùa toàn chuỗi không đi tuyến này. */
export function seasonSummary(row: seasons): SeasonSummary {
  if (row.property_id === null) throw new Error('SEASON_PROPERTY_REQUIRED');
  const version = Number(row.version);
  if (!Number.isSafeInteger(version)) throw new Error('SEASON_VERSION_UNREPRESENTABLE');
  return seasonSummarySchema.parse({
    id: row.id,
    propertyId: row.property_id,
    name: row.name,
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    multiplier: Number(row.multiplier),
    priority: row.priority,
    weekendSurchargeEnabled: row.weekend_surcharge_enabled,
    version,
  });
}

/** Ảnh chụp audit: giữ cả `code`/`status` và hệ số dạng chuỗi gốc để đối chiếu thẳng với CSDL. */
export function seasonSnapshot(row: seasons) {
  return {
    ...seasonSummary(row),
    code: row.code,
    status: row.status,
    multiplierExact: row.multiplier.toString(),
  };
}
