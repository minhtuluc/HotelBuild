import { describe, expect, test } from 'vitest';
import { reportTable } from '../src/export/report-tables.js';

/**
 * HB-163 — ảnh chụp báo cáo (API lưu trong `operations.result_json`) ⇒ bảng ghi tệp: nhãn cột của tệp,
 * đúng thứ tự ô, số nguyên VND không dấu phân cách, và ô trống cho trường tuỳ chọn thiếu.
 */
const OCCUPANCY = {
  groupBy: 'DAY',
  from: '2026-11-01',
  to: '2026-11-04',
  rows: [
    {
      key: '2026-11-01',
      businessDate: '2026-11-01',
      propertyId: 'prop-1',
      roomTypeId: 'room-1',
      soldUnits: 2,
      availableUnits: 8,
      occupancyPct: 25,
    },
    { key: '2026-11-02', soldUnits: 0, availableUnits: 0, occupancyPct: 0 },
  ],
};

const ADR_REVPAR = {
  groupBy: 'ROOM_TYPE',
  from: '2026-11-01',
  to: '2026-11-04',
  rows: [
    {
      key: '2026-11-01',
      businessDate: '2026-11-01',
      propertyId: 'prop-1',
      roomNightsSold: 4,
      roomNightsAvailable: 10,
      netRevenue: 4_000_000,
      adr: 1_000_000,
      revpar: 400_000,
    },
    {
      key: '2026-11-02',
      roomNightsSold: 0,
      roomNightsAvailable: 0,
      netRevenue: 0,
      adr: 0,
      revpar: 0,
    },
  ],
};

const REVENUE_BY_CHANNEL = {
  from: '2026-11-01',
  to: '2026-11-04',
  rows: [
    {
      channelCode: 'WEB',
      grossAmount: 5_000_000,
      commissionAmount: 100_000,
      netAmount: 4_900_000,
      bookings: 3,
    },
  ],
};

const CANCELLATIONS = {
  from: '2026-11-01',
  to: '2026-11-04',
  cancellationRate: 0.25,
  rows: [
    { ratePlanCode: 'FLEX7', appliedTierOffsetHours: -1, cancellations: 1, refundAmount: 500_000 },
  ],
};

describe('HB-163 · reportTable', () => {
  test('occupancy ⇒ tiêu đề "Công suất", ô trống cho trường tuỳ chọn thiếu', () => {
    const table = reportTable('occupancy', OCCUPANCY);
    expect(table.sheet).toBe('Công suất');
    expect(table.headers).toEqual([
      'Nhóm',
      'Ngày',
      'Cơ sở',
      'Loại phòng',
      'Đơn vị đã bán',
      'Đơn vị khả dụng',
      'Công suất (%)',
    ]);
    expect(table.rows).toEqual([
      ['2026-11-01', '2026-11-01', 'prop-1', 'room-1', '2', '8', '25'],
      ['2026-11-02', '', '', '', '0', '0', '0'],
    ]);
  });

  test('adr-revpar ⇒ tiêu đề "ADR-RevPAR", doanh thu thuần giữ nguyên số âm', () => {
    const table = reportTable('adr-revpar', {
      ...ADR_REVPAR,
      rows: [
        ...ADR_REVPAR.rows,
        {
          key: '2026-11-03',
          roomNightsSold: 1,
          roomNightsAvailable: 1,
          netRevenue: -50_000,
          adr: 0,
          revpar: 0,
        },
      ],
    });
    expect(table.sheet).toBe('ADR-RevPAR');
    expect(table.headers).toEqual([
      'Nhóm',
      'Ngày',
      'Cơ sở',
      'Phòng-đêm đã bán',
      'Phòng-đêm khả dụng',
      'Doanh thu thuần',
      'ADR',
      'RevPAR',
    ]);
    expect(table.rows).toEqual([
      ['2026-11-01', '2026-11-01', 'prop-1', '4', '10', '4000000', '1000000', '400000'],
      ['2026-11-02', '', '', '0', '0', '0', '0', '0'],
      ['2026-11-03', '', '', '1', '1', '-50000', '0', '0'],
    ]);
  });

  test('revenue-by-channel ⇒ tiêu đề "Doanh thu theo kênh", số nguyên không dấu phân cách', () => {
    const table = reportTable('revenue-by-channel', REVENUE_BY_CHANNEL);
    expect(table.sheet).toBe('Doanh thu theo kênh');
    expect(table.headers).toEqual([
      'Kênh',
      'Doanh thu gộp',
      'Hoa hồng',
      'Doanh thu thuần',
      'Số booking',
    ]);
    expect(table.rows).toEqual([['WEB', '5000000', '100000', '4900000', '3']]);
  });

  test('cancellations ⇒ tiêu đề "Huỷ & hoàn", giữ bậc -1 (bậc bắt tất)', () => {
    const table = reportTable('cancellations', CANCELLATIONS);
    expect(table.sheet).toBe('Huỷ & hoàn');
    expect(table.headers).toEqual(['Gói giá', 'Bậc (giờ trước nhận phòng)', 'Số huỷ', 'Tiền hoàn']);
    expect(table.rows).toEqual([['FLEX7', '-1', '1', '500000']]);
  });

  test('ảnh chụp rỗng ⇒ bảng chỉ có tiêu đề', () => {
    expect(reportTable('occupancy', { ...OCCUPANCY, rows: [] }).rows).toEqual([]);
    expect(reportTable('cancellations', { ...CANCELLATIONS, rows: [] }).rows).toEqual([]);
  });

  test('ảnh chụp sai khuôn ⇒ ném lỗi (không ghi tệp rác)', () => {
    expect(() => reportTable('adr-revpar', { rows: 'không-phải-mảng' })).toThrow();
  });
});
