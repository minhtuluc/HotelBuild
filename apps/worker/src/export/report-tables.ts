import {
  adrRevparReportSchema,
  cancellationsReportSchema,
  occupancyReportSchema,
  revenueByChannelReportSchema,
} from '@pinehill/contracts';
import type { ReportExportRequest } from '@pinehill/contracts';

export interface ReportTable {
  readonly sheet: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Chuyển ảnh chụp báo cáo (do API lưu trong `operations.result_json`) thành bảng để ghi tệp.
 * Nhãn cột là **của tệp xuất** (không dùng danh mục i18n của web) nhưng giữ đúng thuật ngữ của màn hình;
 * số ghi dạng chữ số thuần để kế toán mở bằng bảng tính, không thêm dấu phân cách nghìn.
 */
function text(value: string | undefined): string {
  return value ?? '';
}

export function reportTable(report: ReportExportRequest['report'], snapshot: unknown): ReportTable {
  if (report === 'occupancy') {
    const parsed = occupancyReportSchema.parse(snapshot);
    return {
      sheet: 'Công suất',
      headers: [
        'Nhóm',
        'Ngày',
        'Cơ sở',
        'Loại phòng',
        'Đơn vị đã bán',
        'Đơn vị khả dụng',
        'Công suất (%)',
      ],
      rows: parsed.rows.map((row) => [
        row.key,
        text(row.businessDate),
        text(row.propertyId),
        text(row.roomTypeId),
        String(row.soldUnits),
        String(row.availableUnits),
        String(row.occupancyPct),
      ]),
    };
  }
  if (report === 'adr-revpar') {
    const parsed = adrRevparReportSchema.parse(snapshot);
    return {
      sheet: 'ADR-RevPAR',
      headers: [
        'Nhóm',
        'Ngày',
        'Cơ sở',
        'Phòng-đêm đã bán',
        'Phòng-đêm khả dụng',
        'Doanh thu thuần',
        'ADR',
        'RevPAR',
      ],
      rows: parsed.rows.map((row) => [
        row.key,
        text(row.businessDate),
        text(row.propertyId),
        String(row.roomNightsSold),
        String(row.roomNightsAvailable),
        String(row.netRevenue),
        String(row.adr),
        String(row.revpar),
      ]),
    };
  }
  if (report === 'revenue-by-channel') {
    const parsed = revenueByChannelReportSchema.parse(snapshot);
    return {
      sheet: 'Doanh thu theo kênh',
      headers: ['Kênh', 'Doanh thu gộp', 'Hoa hồng', 'Doanh thu thuần', 'Số booking'],
      rows: parsed.rows.map((row) => [
        row.channelCode,
        String(row.grossAmount),
        String(row.commissionAmount),
        String(row.netAmount),
        String(row.bookings),
      ]),
    };
  }
  const parsed = cancellationsReportSchema.parse(snapshot);
  return {
    sheet: 'Huỷ & hoàn',
    headers: ['Gói giá', 'Bậc (giờ trước nhận phòng)', 'Số huỷ', 'Tiền hoàn'],
    rows: parsed.rows.map((row) => [
      row.ratePlanCode,
      String(row.appliedTierOffsetHours),
      String(row.cancellations),
      String(row.refundAmount),
    ]),
  };
}
