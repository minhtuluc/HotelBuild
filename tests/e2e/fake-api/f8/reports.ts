/**
 * API giả F8 — báo cáo (HB-164/HB-165). Dựng phản hồi đúng hợp đồng HB-160 để các màn SCR-52…55 chạy
 * được khi backend HB-162/163 chưa merge: báo cáo đọc, `POST /reports/export` (202) và `GET /operations/{id}`.
 */
import type { Page, Route } from '@playwright/test';

export const PROPERTY = {
  id: 'p1',
  name: 'Pine Hill Đà Lạt',
  status: 'ACTIVE',
  activeRoomCount: 20,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 3,
};

export const OCCUPANCY_REPORT = {
  groupBy: 'DAY' as const,
  from: '2026-12-24',
  to: '2026-12-27',
  rows: [
    { key: '2026-12-24', businessDate: '2026-12-24', soldUnits: 12, availableUnits: 20, occupancyPct: 60 },
    { key: '2026-12-25', businessDate: '2026-12-25', soldUnits: 18, availableUnits: 20, occupancyPct: 90 },
  ],
};

/** DOR đếm theo đơn vị bán (giường) — BR-PROP-03. */
export const ADR_REVPAR_REPORT = {
  groupBy: 'DAY' as const,
  from: '2026-12-24',
  to: '2026-12-27',
  rows: [
    {
      key: '2026-12-24',
      businessDate: '2026-12-24',
      roomNightsSold: 12,
      roomNightsAvailable: 20,
      netRevenue: 13_440_000,
      adr: 1_120_000,
      revpar: 672_000,
    },
  ],
};

export const REVENUE_REPORT = {
  from: '2026-12-24',
  to: '2026-12-27',
  rows: [
    { channelCode: 'WEB' as const, grossAmount: 8_112_000, commissionAmount: 0, netAmount: 8_112_000, bookings: 5 },
    { channelCode: 'OTA_BOOKING' as const, grossAmount: 5_328_750, commissionAmount: 959_175, netAmount: 4_369_575, bookings: 3 },
  ],
};

/** Huỷ & hoàn cọc (UC-REP-03): tỷ lệ huỷ do máy chủ trả, tiền hoàn theo bậc (bậc −1 là bắt tất). */
export const CANCELLATIONS_REPORT = {
  from: '2026-12-24',
  to: '2026-12-27',
  cancellationRate: 12.5,
  rows: [
    { ratePlanCode: 'FLEX7' as const, appliedTierOffsetHours: 72, cancellations: 2, refundAmount: 1_304_000 },
    { ratePlanCode: 'NONREF' as const, appliedTierOffsetHours: -1, cancellations: 1, refundAmount: 0 },
  ],
};

/** Quá tải & điều chuyển (UC-REP-04, BR-OVER-15): ba khoản chi phí + tổng do máy chủ trả. */
export const OVERBOOKING_REPORT = {
  from: '2026-12-24',
  to: '2026-12-27',
  rows: [
    {
      caseId: 'ob-1',
      propertyId: 'p1',
      roomTypeId: 'rt1',
      businessDate: '2026-12-24',
      status: 'RESOLVED' as const,
      detectedAt: '2026-12-23T09:00:00.000Z',
      resolvedAt: '2026-12-23T10:30:00.000Z',
      mergeDiscountAmount: 200_000,
      walkOutCompensationAmount: 1_100_000,
      transportSupportAmount: 150_000,
      totalCost: 1_450_000,
    },
    {
      caseId: 'ob-2',
      propertyId: 'p1',
      roomTypeId: 'rt1',
      businessDate: '2026-12-25',
      status: 'OPEN' as const,
      detectedAt: '2026-12-24T08:00:00.000Z',
      resolvedAt: null,
      mergeDiscountAmount: 0,
      walkOutCompensationAmount: 0,
      transportSupportAmount: 100_000,
      totalCost: 100_000,
    },
  ],
};

export const OPERATION_REF = {
  operationId: 'op-1',
  status: 'PENDING' as const,
  statusUrl: '/api/session/sys/operations/op-1',
};

export const OPERATION_STATUSES = {
  RUNNING: { operationId: 'op-1', status: 'RUNNING' as const },
  SUCCEEDED: { operationId: 'op-1', status: 'SUCCEEDED' as const, resultRef: 'reports/op-1.csv' },
  FAILED: {
    operationId: 'op-1',
    status: 'FAILED' as const,
    errorCode: 'E_GEN_INTERNAL',
    errorMessage: 'Xuất báo cáo thất bại',
  },
};

function json(route: Route, status: number, body: string): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body });
}

export interface F8ReportOptions {
  /** Chuỗi trạng thái tác vụ trả lần lượt cho mỗi lần hỏi; mặc định `SUCCEEDED`. */
  operationStatuses?: readonly unknown[];
  /** Mã HTTP cho lần đọc báo cáo (ví dụ 403). */
  readStatus?: number;
  /** Thân lỗi khi `readStatus` khác 200. */
  readErrorBody?: string;
}

export interface F8ReportSpy {
  exports: () => string[];
  polls: () => number;
  reportCalls: () => number;
  reportUrls: () => string[];
}

/**
 * Cài API giả cho báo cáo F8. Trả về spy để ca kiểm khẳng định thân lệnh xuất và số lần hỏi trạng thái.
 */
export function installReportApi(page: Page, options: F8ReportOptions = {}): F8ReportSpy {
  const exports: string[] = [];
  let polls = 0;
  let reportCalls = 0;
  const reportUrls: string[] = [];
  const statuses = options.operationStatuses ?? [OPERATION_STATUSES.SUCCEEDED];
  const readStatus = options.readStatus ?? 200;

  void page.route('**/api/session/sys/properties**', (route) => json(route, 200, JSON.stringify({
    data: [PROPERTY],
    meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 },
  })));

  const reports: readonly [string, unknown][] = [
    ['**/api/session/sys/reports/occupancy**', OCCUPANCY_REPORT],
    ['**/api/session/sys/reports/adr-revpar**', ADR_REVPAR_REPORT],
    ['**/api/session/sys/reports/revenue-by-channel**', REVENUE_REPORT],
    ['**/api/session/sys/reports/cancellations**', CANCELLATIONS_REPORT],
    ['**/api/session/sys/reports/overbooking**', OVERBOOKING_REPORT],
  ];
  for (const [pattern, body] of reports) {
    void page.route(pattern, (route) => {
      reportCalls += 1;
      reportUrls.push(route.request().url());
      return readStatus === 200
        ? json(route, 200, JSON.stringify(body))
        : json(route, readStatus, options.readErrorBody ?? '{}');
    });
  }

  void page.route('**/api/session/sys/reports/export', async (route) => {
    exports.push(route.request().postData() ?? '');
    return json(route, 202, JSON.stringify(OPERATION_REF));
  });

  void page.route('**/api/session/sys/operations/**', (route) => {
    const view = statuses[Math.min(polls, statuses.length - 1)] ?? OPERATION_STATUSES.SUCCEEDED;
    polls += 1;
    return json(route, 200, JSON.stringify(view));
  });

  return {
    exports: () => exports,
    polls: () => polls,
    reportCalls: () => reportCalls,
    reportUrls: () => reportUrls,
  };
}
