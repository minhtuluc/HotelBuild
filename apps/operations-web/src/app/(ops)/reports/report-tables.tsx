'use client';

/** Bảng và khối trạng thái dùng chung cho SCR-52/SCR-53: in nguyên số máy chủ trả (BR-REP-01). */
import type { ReactElement } from 'react';
import type {
  AdrRevparReport,
  CancellationsReport,
  OccupancyReport,
  OperationStatusView,
  OverbookingReport,
  RevenueByChannelReport,
} from '@pinehill/contracts';
import { formatDateTimeVn, formatMoney, formatStatusWithEnum } from '@pinehill/ui-web';
import { formatBusinessDate } from '../../../lib/business-date';
import { t, type OperationsMessageKey } from '../../../lib/i18n';
import { OPERATION_STATUS_KEY, OVERBOOKING_STATUS_KEY } from './report-shared';

/** Nhãn Việt + mã enum kênh (NFR-LOC-01): không viết cứng chuỗi trong component. */
const CHANNEL_LABEL: Readonly<Record<string, OperationsMessageKey>> = {
  WEB: 'enum.channelCode.WEB',
  PHONE: 'enum.channelCode.PHONE',
  WALKIN: 'enum.channelCode.WALKIN',
  OTA_BOOKING: 'enum.channelCode.OTA_BOOKING',
  OTA_AGODA: 'enum.channelCode.OTA_AGODA',
  OTA_AIRBNB: 'enum.channelCode.OTA_AIRBNB',
  AGENCY: 'enum.channelCode.AGENCY',
};

const CELL = { textAlign: 'start', borderBottom: '1px solid var(--color-border)' } as const;

function Table({
  testId,
  title,
  head,
  children,
}: {
  testId: string;
  title: string;
  head: readonly string[];
  children: ReactElement;
}): ReactElement {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid={testId} style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>{title}</caption>
        <thead>
          <tr>
            {head.map((label) => (
              <th key={label} scope="col" style={CELL}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Công suất (UC-REP-01): đơn vị bán là phòng, riêng DOR là giường (BR-PROP-03). */
export function OccupancyTable({ report }: { report: OccupancyReport }): ReactElement {
  return (
    <>
      <Table
        testId="occupancy-table"
        title={t('reports.occupancy.table')}
        head={[
          t('reports.col.key'),
          t('reports.col.soldUnits'),
          t('reports.col.availableUnits'),
          t('reports.col.occupancyPct'),
        ]}
      >
        <>
          {report.rows.map((row) => (
            <tr key={row.key} data-testid={`occupancy-row-${row.key}`}>
              <td style={CELL}>{row.key}</td>
              <td style={CELL}>{row.soldUnits}</td>
              <td style={CELL}>{row.availableUnits}</td>
              <td style={CELL}>{row.occupancyPct}</td>
            </tr>
          ))}
        </>
      </Table>
      <p role="note" style={{ margin: 0 }}>
        {t('reports.occupancy.formula')}
      </p>
    </>
  );
}

/** ADR/RevPAR trên doanh thu **thuần** (BR-RATE-08); mẫu số là phòng-đêm bán/khả dụng. */
export function AdrRevparTable({ report }: { report: AdrRevparReport }): ReactElement {
  return (
    <>
      <Table
        testId="adr-revpar-table"
        title={t('reports.adr.table')}
        head={[
          t('reports.col.key'),
          t('reports.col.roomNightsSold'),
          t('reports.col.roomNightsAvailable'),
          t('reports.col.netRevenue'),
          t('reports.col.adr'),
          t('reports.col.revpar'),
        ]}
      >
        <>
          {report.rows.map((row) => (
            <tr key={row.key} data-testid={`adr-row-${row.key}`}>
              <td style={CELL}>{row.key}</td>
              <td style={CELL}>{row.roomNightsSold}</td>
              <td style={CELL}>{row.roomNightsAvailable}</td>
              <td style={CELL}>{formatMoney(row.netRevenue)}</td>
              <td style={CELL}>{formatMoney(row.adr)}</td>
              <td style={CELL}>{formatMoney(row.revpar)}</td>
            </tr>
          ))}
        </>
      </Table>
      <p role="note" style={{ margin: 0 }}>
        {t('reports.adr.formula')}
      </p>
    </>
  );
}

/** Doanh thu theo kênh (UC-REP-02): gộp − hoa hồng = thuần, đọc từ snapshot giá lúc bán. */
export function RevenueByChannelTable({
  report,
}: {
  report: RevenueByChannelReport;
}): ReactElement {
  return (
    <>
      <Table
        testId="revenue-table"
        title={t('reports.revenue.table')}
        head={[
          t('reports.col.channel'),
          t('reports.col.gross'),
          t('reports.col.commission'),
          t('reports.col.net'),
          t('reports.col.bookings'),
        ]}
      >
        <>
          {report.rows.map((row) => (
            <tr key={row.channelCode} data-testid={`revenue-row-${row.channelCode}`}>
              <td style={CELL}>{t(CHANNEL_LABEL[row.channelCode] ?? 'reports.col.channel')}</td>
              <td style={CELL}>{formatMoney(row.grossAmount)}</td>
              <td style={CELL}>{formatMoney(row.commissionAmount)}</td>
              <td style={CELL}>{formatMoney(row.netAmount)}</td>
              <td style={CELL}>{row.bookings}</td>
            </tr>
          ))}
        </>
      </Table>
      <p role="note" style={{ margin: 0 }}>
        {t('reports.revenue.formula')}
      </p>
    </>
  );
}

/** Gói giá trong báo cáo huỷ (NFR-LOC-01) — nhãn lấy từ danh mục, không viết cứng trong component. */
const RATE_PLAN_LABEL: Readonly<Record<string, OperationsMessageKey>> = {
  FLEX7: 'enum.ratePlanCode.FLEX7',
  SAVER3: 'enum.ratePlanCode.SAVER3',
  NONREF: 'enum.ratePlanCode.NONREF',
  LONGSTAY14: 'enum.ratePlanCode.LONGSTAY14',
};

/** Huỷ phòng & hoàn cọc theo gói/bậc (UC-REP-03): bậc `-1` là bậc bắt tất (BR-CANCEL-01). */
export function CancellationsTable({ report }: { report: CancellationsReport }): ReactElement {
  return (
    <>
      <Table
        testId="cancellations-table"
        title={t('reports.cancel.table')}
        head={[
          t('reports.col.ratePlan'),
          t('reports.col.tier'),
          t('reports.col.cancellations'),
          t('reports.col.refundAmount'),
        ]}
      >
        <>
          {report.rows.map((row) => (
            <tr
              key={`${row.ratePlanCode}-${row.appliedTierOffsetHours}`}
              data-testid={`cancel-row-${row.ratePlanCode}-${row.appliedTierOffsetHours}`}
            >
              <td style={CELL}>{t(RATE_PLAN_LABEL[row.ratePlanCode] ?? 'reports.col.ratePlan')}</td>
              <td style={CELL}>
                {row.appliedTierOffsetHours < 0
                  ? t('reports.cancel.catchAll')
                  : `${row.appliedTierOffsetHours}h`}
              </td>
              <td style={CELL}>{row.cancellations}</td>
              <td style={CELL}>{formatMoney(row.refundAmount)}</td>
            </tr>
          ))}
        </>
      </Table>
      <p role="note" style={{ margin: 0 }}>
        {t('reports.cancel.formula')}
      </p>
    </>
  );
}

/** Ca quá tải & chi phí xử lý (UC-REP-04, BR-OVER-15/16): ba khoản chi phí đọc nguyên từ máy chủ. */
export function OverbookingTable({ report }: { report: OverbookingReport }): ReactElement {
  return (
    <>
      <Table
        testId="overbooking-table"
        title={t('reports.over.table')}
        head={[
          t('reports.col.caseId'),
          t('reports.col.property'),
          t('reports.col.businessDate'),
          t('reports.col.status'),
          t('reports.col.detectedAt'),
          t('reports.col.resolvedAt'),
          t('reports.col.mergeDiscount'),
          t('reports.col.walkOut'),
          t('reports.col.transport'),
          t('reports.col.totalCost'),
        ]}
      >
        <>
          {report.rows.map((row) => (
            <tr key={row.caseId} data-testid={`overbooking-row-${row.caseId}`}>
              <td style={CELL}>{row.caseId}</td>
              <td style={CELL}>{row.propertyId}</td>
              <td style={CELL}>{formatBusinessDate(row.businessDate)}</td>
              <td style={CELL}>
                {formatStatusWithEnum(t(OVERBOOKING_STATUS_KEY[row.status]), row.status)}
              </td>
              <td style={CELL}>{formatDateTimeVn(row.detectedAt)}</td>
              <td style={CELL}>
                {row.resolvedAt === null ? '—' : formatDateTimeVn(row.resolvedAt)}
              </td>
              <td style={CELL}>{formatMoney(row.mergeDiscountAmount)}</td>
              <td style={CELL}>{formatMoney(row.walkOutCompensationAmount)}</td>
              <td style={CELL}>{formatMoney(row.transportSupportAmount)}</td>
              <td style={CELL}>{formatMoney(row.totalCost)}</td>
            </tr>
          ))}
        </>
      </Table>
      <p role="note" style={{ margin: 0 }}>
        {t('reports.over.formula')}
      </p>
    </>
  );
}

/** Tiến trình xuất báo cáo bất đồng bộ (§6): `PENDING/RUNNING/SUCCEEDED/FAILED` + tham chiếu kết quả. */
export function OperationPanel({ view }: { view: OperationStatusView }): ReactElement {
  return (
    <p role="status" data-testid="report-operation" style={{ margin: 0 }}>
      {t('reports.export.status', { status: t(OPERATION_STATUS_KEY[view.status]) })} ·{' '}
      {view.operationId}
      {view.resultRef === undefined ? null : ` · ${view.resultRef}`}
      {view.errorCode === undefined ? null : ` · ${view.errorCode}`}
    </p>
  );
}
