import {
  channelCodeSchema,
  ratePlanCodeSchema,
  type AdrRevparReport,
  type CancellationsReport,
  type ForceMajeureReport,
  type OccupancyReport,
  type OverbookingReport,
  type RevenueByChannelReport,
} from '@pinehill/contracts';
import {
  calculateReportingMetrics,
  formatFraction,
  type ExactFraction,
  type ReportingMetrics,
  type RoomNightFact,
} from '@pinehill/domain/reporting';
import type {
  CancellationRateRow,
  CancellationTierRow,
  ChannelRevenueRow,
  ForceMajeureRow,
  OverbookingRow,
  RoomNightAggregate,
} from './queries.js';
import type { ReportGroupBy } from './validation.js';

/**
 * Chuyển số nguyên lớn từ CSDL về `number` an toàn. Vượt `Number.MAX_SAFE_INTEGER` là lỗi dữ liệu
 * (không được trả số đã mất chính xác) — giống `E_REPORT_UNSAFE_TOTAL` của engine HB-161.
 */
export function safeAmount(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('REP_UNSAFE_TOTAL');
  return Number(value);
}

function fractionValue(fraction: ExactFraction | null, decimals: number, percent: boolean): number {
  if (fraction === null) return 0;
  const formatted = formatFraction(fraction, decimals, percent);
  if (!formatted.ok) throw new Error(`REP_FRACTION_${formatted.error.code}`);
  return Number(formatted.value.text);
}

/** `businessDate` của cột `date` (Prisma trả `Date` ở UTC nửa đêm) → `YYYY-MM-DD`. */
export function businessDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export interface DayTotals {
  readonly day: string;
  readonly sold: number;
  readonly available: number;
  readonly netRevenue: number;
}

export interface GroupTotals {
  readonly key: string;
  readonly businessDate?: string;
  readonly propertyId?: string;
  readonly roomTypeId?: string;
  readonly days: readonly DayTotals[];
}

interface DaySums {
  sold: number;
  available: number;
  net: number;
}

interface GroupBucket {
  propertyId: string;
  roomTypeId: string;
  readonly days: Map<string, DaySums>;
}

/**
 * Gộp dòng SQL (cơ sở × loại phòng × ngày) về khoá báo cáo theo `groupBy`. Cộng số nguyên trong ứng
 * dụng diễn ra trên tổng đã gộp ở CSDL nên không kéo dòng thô (HB-162 AC1).
 */
export function groupAggregates(
  rows: readonly RoomNightAggregate[],
  groupBy: ReportGroupBy,
): readonly GroupTotals[] {
  const groups = new Map<string, GroupBucket>();
  for (const row of rows) {
    const day = businessDate(row.d);
    const id =
      groupBy === 'DAY' ? day : groupBy === 'ROOM_TYPE' ? row.room_type_id : row.property_id;
    const group = groups.get(id) ?? {
      propertyId: '',
      roomTypeId: '',
      days: new Map<string, DaySums>(),
    };
    const totals = group.days.get(day) ?? { sold: 0, available: 0, net: 0 };
    totals.sold += safeAmount(row.sold);
    totals.available += safeAmount(row.available);
    totals.net += safeAmount(row.net);
    group.days.set(day, totals);
    if (groupBy === 'PROPERTY') group.propertyId = id;
    if (groupBy === 'ROOM_TYPE') group.roomTypeId = id;
    groups.set(id, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      ...(groupBy === 'DAY' ? { businessDate: key } : {}),
      ...(groupBy === 'PROPERTY' ? { propertyId: key } : {}),
      ...(groupBy === 'ROOM_TYPE' ? { roomTypeId: key } : {}),
      days: [...group.days.entries()]
        .map(([day, totals]) => ({
          day,
          sold: totals.sold,
          available: totals.available,
          netRevenue: totals.net,
        }))
        .sort((left, right) => (left.day < right.day ? -1 : 1)),
    }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

/**
 * Dựng fact phòng-đêm cho engine HB-161. Mỗi ngày của một nhóm là một fact: `available` được mã hoá
 * bằng `kind='DOR'` + `bedCount=available` (đúng mô hình phòng nhiều giường), còn ngày không còn đơn
 * vị khả dụng dùng `kind='PRIVATE'`, `active=false` để không cộng vào mẫu số. Nhờ vậy phép chia
 * công suất/ADR/RevPAR vẫn do **một** định nghĩa BR-REP-01 quyết định, không viết lại công thức.
 */
function factsOf(totals: GroupTotals): readonly RoomNightFact[] {
  return totals.days.map((day) => {
    if (day.netRevenue < 0 || day.sold < 0 || day.available < 0)
      throw new Error('REP_NEGATIVE_ROOM_REVENUE');
    return day.available > 0
      ? {
          roomId: day.day,
          businessDate: day.day,
          kind: 'DOR' as const,
          bedCount: day.available,
          active: true,
          blocked: false,
          soldUnits: day.sold,
          netRevenueVnd: day.netRevenue,
        }
      : {
          roomId: day.day,
          businessDate: day.day,
          kind: 'PRIVATE' as const,
          bedCount: 1,
          active: false,
          blocked: false,
          soldUnits: day.sold,
          netRevenueVnd: day.netRevenue,
        };
  });
}

function metricsOf(totals: GroupTotals, from: string, to: string): ReportingMetrics {
  const result = calculateReportingMetrics({
    from,
    to,
    roomNights: factsOf(totals),
    bookings: [],
    overbookingCosts: [],
  });
  if (!result.ok) throw new Error(`REP_METRICS_${result.error.code}`);
  return result.value;
}

/** SCR-52: công suất theo nhóm, số đã chuẩn hoá làm tròn HALF_UP 2 chữ số (BR-GEN-01). */
export function occupancyReport(
  rows: readonly RoomNightAggregate[],
  groupBy: ReportGroupBy,
  from: string,
  to: string,
): OccupancyReport {
  return {
    groupBy,
    from,
    to,
    rows: groupAggregates(rows, groupBy).map((group) => {
      const metrics = metricsOf(group, from, to);
      return {
        key: group.key,
        ...(group.businessDate === undefined ? {} : { businessDate: group.businessDate }),
        ...(group.propertyId === undefined ? {} : { propertyId: group.propertyId }),
        ...(group.roomTypeId === undefined ? {} : { roomTypeId: group.roomTypeId }),
        soldUnits: metrics.soldUnitNights,
        availableUnits: metrics.availableUnitNights,
        occupancyPct: fractionValue(metrics.occupancy, 2, true),
      };
    }),
  };
}

/** SCR-52: ADR/RevPAR trên doanh thu **thuần**; ADR/RevPAR trả số nguyên VND (HALF_UP). */
export function adrRevparReport(
  rows: readonly RoomNightAggregate[],
  groupBy: ReportGroupBy,
  from: string,
  to: string,
): AdrRevparReport {
  return {
    groupBy,
    from,
    to,
    rows: groupAggregates(rows, groupBy).map((group) => {
      const metrics = metricsOf(group, from, to);
      return {
        key: group.key,
        ...(group.businessDate === undefined ? {} : { businessDate: group.businessDate }),
        ...(group.propertyId === undefined ? {} : { propertyId: group.propertyId }),
        roomNightsSold: metrics.soldUnitNights,
        roomNightsAvailable: metrics.availableUnitNights,
        netRevenue: metrics.netRevenueVnd,
        adr: fractionValue(metrics.adr, 0, false),
        revpar: fractionValue(metrics.revpar, 0, false),
      };
    }),
  };
}

/** SCR-53: gộp − hoa hồng = thuần; mã kênh phải thuộc danh mục canonical. */
export function revenueByChannelReport(
  rows: readonly ChannelRevenueRow[],
  from: string,
  to: string,
): RevenueByChannelReport {
  return {
    from,
    to,
    rows: rows.map((row) => {
      const code = channelCodeSchema.safeParse(row.channel_code);
      if (!code.success) throw new Error('REP_CHANNEL_CODE_UNKNOWN');
      const gross = safeAmount(row.gross);
      const commission = safeAmount(row.commission);
      return {
        channelCode: code.data,
        grossAmount: gross,
        commissionAmount: commission,
        netAmount: gross - commission,
        bookings: safeAmount(row.bookings),
      };
    }),
  };
}

/** SCR-54: tỷ lệ huỷ theo BR-REP-01, kèm bảng theo bậc chính sách đã áp. */
export function cancellationsReport(
  rate: CancellationRateRow | undefined,
  tiers: readonly CancellationTierRow[],
  from: string,
  to: string,
): CancellationsReport {
  const cancelled = rate === undefined ? 0n : rate.cancelled;
  const created = rate === undefined ? 0n : rate.created;
  const fraction = created === 0n ? null : { numerator: cancelled, denominator: created };
  return {
    from,
    to,
    cancellationRate: fractionValue(fraction, 2, false),
    rows: tiers.map((tier) => {
      const code = ratePlanCodeSchema.safeParse(tier.rate_plan_code);
      if (!code.success) throw new Error('REP_RATE_PLAN_CODE_UNKNOWN');
      return {
        ratePlanCode: code.data,
        appliedTierOffsetHours: tier.tier_hours,
        cancellations: safeAmount(tier.cancellations),
        refundAmount: safeAmount(tier.refund),
      };
    }),
  };
}

/** SCR-54: báo cáo bất khả kháng riêng (BR-CANCEL-13, chỉ OWNER). */
export function forceMajeureReport(
  rows: readonly ForceMajeureRow[],
  from: string,
  to: string,
): ForceMajeureReport {
  return {
    from,
    to,
    rows: rows.map((row) => ({
      bookingId: row.booking_id,
      propertyId: row.property_id,
      cancelledAt: row.cancelled_at.toISOString(),
      refundAmount: safeAmount(row.refund),
      note: row.note,
    })),
  };
}

/** SCR-55: chi phí xử lý quá tải = chiết khấu ghép + bồi thường walk-out + hỗ trợ đưa đón (BR-OVER-15). */
export function overbookingReport(
  rows: readonly OverbookingRow[],
  from: string,
  to: string,
): OverbookingReport {
  return {
    from,
    to,
    rows: rows.map((row) => {
      const mergeDiscountAmount = safeAmount(row.merge_discount);
      const walkOutCompensationAmount = safeAmount(row.walk_out);
      const transportSupportAmount = safeAmount(row.transport);
      return {
        caseId: row.case_id,
        propertyId: row.property_id,
        roomTypeId: row.room_type_id,
        businessDate: businessDate(row.business_date),
        status: overbookingStatus(row.status),
        detectedAt: row.detected_at.toISOString(),
        resolvedAt: row.resolved_at === null ? null : row.resolved_at.toISOString(),
        mergeDiscountAmount,
        walkOutCompensationAmount,
        transportSupportAmount,
        // Cộng bằng bigint rồi mới kiểm miền an toàn: ba cấu phần có thể hợp lệ riêng lẻ nhưng tổng thì không.
        totalCost: safeAmount(row.merge_discount + row.walk_out + row.transport),
      };
    }),
  };
}

function overbookingStatus(value: string): OverbookingReport['rows'][number]['status'] {
  if (value === 'OPEN' || value === 'PROPOSED' || value === 'RESOLVED' || value === 'ESCALATED')
    return value;
  throw new Error('REP_OVERBOOKING_STATUS_UNKNOWN');
}
