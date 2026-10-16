/**
 * HB-165 / HB-186: cột "Ngày" của bảng quá tải hiển thị ngày nghiệp vụ date-only dạng `dd/MM/yyyy`,
 * không còn chuỗi ISO nguyên văn. Ngày nghiệp vụ không bị quy đổi múi giờ.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OverbookingReport } from '@pinehill/contracts';
import { formatBusinessDate } from '../../src/lib/business-date';
import { OverbookingTable } from '../../src/app/(ops)/reports/report-tables';

const REPORT: OverbookingReport = {
  from: '2026-12-24',
  to: '2026-12-27',
  rows: [
    {
      caseId: 'ob-1',
      propertyId: 'p1',
      roomTypeId: 'rt1',
      businessDate: '2026-12-24',
      status: 'RESOLVED',
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
      status: 'OPEN',
      detectedAt: '2026-12-24T08:00:00.000Z',
      resolvedAt: null,
      mergeDiscountAmount: 0,
      walkOutCompensationAmount: 0,
      transportSupportAmount: 100_000,
      totalCost: 100_000,
    },
  ],
};

describe('formatBusinessDate (NFR-LOC-02)', () => {
  it('đổi ngày nghiệp vụ YYYY-MM-DD sang dd/MM/yyyy, không dựng Date', () => {
    expect(formatBusinessDate('2026-12-24')).toBe('24/12/2026');
    expect(formatBusinessDate('2026-01-05')).toBe('05/01/2026');
  });

  it('giữ nguyên giá trị không đúng dạng ngày nghiệp vụ (không bịa ngày)', () => {
    expect(formatBusinessDate('')).toBe('');
    expect(formatBusinessDate('không-phải-ngày')).toBe('không-phải-ngày');
    expect(formatBusinessDate('2026-12')).toBe('2026-12');
  });
});

describe('bảng quá tải — cột ngày (HB-165)', () => {
  it('hiển thị dd/MM/yyyy và không còn ISO nguyên văn', () => {
    const html = renderToStaticMarkup(createElement(OverbookingTable, { report: REPORT }));

    expect(html).toContain('data-testid="overbooking-row-ob-1"');
    expect(html).toContain('24/12/2026');
    expect(html).toContain('25/12/2026');
    expect(html).not.toContain('2026-12-24</td>');
    expect(html).not.toContain('2026-12-25</td>');
  });
});
