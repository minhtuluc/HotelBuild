'use client';

/**
 * Tiện ích tải dữ liệu & hai bảng hiển thị tách từ `seasons-screen.tsx` (SCR-27).
 */
import type { ReactElement } from 'react';
import { createPropertyApi, createRateApi, type ApiClient } from '@pinehill/api-client';
import type { PropertySummary, RoomTypeSummary, SeasonSummary } from '@pinehill/contracts';
import {
  color,
  formatMoney,
  formatMultiplier,
  formatStatusWithEnum,
  space,
} from '@pinehill/ui-web';
import { OPS_TABLE_WRAP_STYLE, OPS_TABULAR_STYLE } from '../../../components/editorial-styles';
import { t } from '../../../lib/i18n';
import type { GridRange } from '../../../lib/inventory-grid';
import type { CalendarRow, RateCalendarEntry, SeasonDraft } from '../../../lib/seasons';

export interface Loaded {
  properties: readonly PropertySummary[];
  roomTypes: readonly RoomTypeSummary[];
  entries: readonly RateCalendarEntry[];
  seasons: readonly SeasonSummary[];
}

export type SeasonTarget = Pick<SeasonDraft, 'propertyId' | 'roomTypeId'>;

/** Chọn giá trị đang dùng: giữ lựa chọn cũ nếu còn hợp lệ, ngược lại lấy mục đầu tiên. */
export function pickId(preferred: string, options: readonly { id: string }[]): string {
  return preferred === '' ? (options[0]?.id ?? '') : preferred;
}

/** Tải danh sách cơ sở, hạng phòng, lịch giá và mùa cho màn SCR-27. */
export async function fetchCalendar(
  client: ApiClient,
  draft: SeasonTarget,
  range: GridRange,
): Promise<Loaded> {
  const propertyApi = createPropertyApi(client);
  const properties = (await propertyApi.list()).data.data;
  const propertyId = pickId(draft.propertyId, properties);
  const roomTypes =
    propertyId === '' ? [] : (await propertyApi.listRoomTypes({ propertyId })).data.data;
  const roomTypeId = pickId(draft.roomTypeId, roomTypes);
  const rateApi = createRateApi(client);
  const entries =
    roomTypeId === ''
      ? []
      : (await rateApi.rateCalendar(roomTypeId, { from: range.from, to: range.to })).data.entries;
  const seasons = propertyId === '' ? [] : (await rateApi.listSeasons({ propertyId })).data.data;
  return { properties, roomTypes, entries, seasons };
}

/** Nhãn Việt + mã enum nguồn giá (BR-RATE-02) — không viết cứng chuỗi trong component (NFR-LOC-01). */
const SOURCE_LABEL: Readonly<
  Record<
    NonNullable<RateCalendarEntry['source']>,
    | 'enum.rateSource.BASE'
    | 'enum.rateSource.SEASON'
    | 'enum.rateSource.OVERRIDE'
    | 'enum.rateSource.RATE_PLAN'
  >
> = {
  BASE: 'enum.rateSource.BASE',
  SEASON: 'enum.rateSource.SEASON',
  OVERRIDE: 'enum.rateSource.OVERRIDE',
  RATE_PLAN: 'enum.rateSource.RATE_PLAN',
};

/** Bảng mùa thắng từng ngày do engine giá trả về (chỉ hiển thị). */
export function WinnerTable({ rows }: { rows: readonly CalendarRow[] }): ReactElement {
  return (
    <div style={OPS_TABLE_WRAP_STYLE}>
      <table data-testid="seasons-calendar" style={OPS_TABULAR_STYLE}>
        <caption
          style={{ textAlign: 'start', padding: space.s3, fontWeight: 500, color: color.text }}
        >
          {t('seasons.calendar.title')}
        </caption>
        <thead>
          <tr>
            {[
              t('seasons.col.date'),
              t('seasons.col.price'),
              t('seasons.col.source'),
              t('seasons.col.season'),
            ].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date}>
              <td>{row.date}</td>
              <td>{formatMoney(row.nightlyPrice)}</td>
              <td>
                {row.source === undefined
                  ? '—'
                  : formatStatusWithEnum(t(SOURCE_LABEL[row.source]), row.source)}
              </td>
              <td data-testid={`season-of-${row.date}`}>{row.seasonName ?? t('seasons.none')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Danh sách mùa hiện có của cơ sở — đọc thẳng từ `GET /seasons` (AC1). */
export function SeasonListTable({ seasons }: { seasons: readonly SeasonSummary[] }): ReactElement {
  const headers = [
    t('seasons.col.name'),
    t('seasons.col.range'),
    t('seasons.col.multiplier'),
    t('seasons.col.priority'),
    t('seasons.col.weekend'),
    t('seasons.col.version'),
  ];
  return (
    <div style={OPS_TABLE_WRAP_STYLE}>
      <table data-testid="seasons-list" style={OPS_TABULAR_STYLE}>
        <caption
          style={{ textAlign: 'start', padding: space.s3, fontWeight: 500, color: color.text }}
        >
          {t('seasons.list.title')}
        </caption>
        <thead>
          <tr>
            {headers.map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {seasons.map((season) => (
            <tr key={season.id} data-testid={`season-${season.name}`}>
              <td style={{ fontWeight: 500 }}>{season.name}</td>
              <td>
                {season.startDate} → {season.endDate}
              </td>
              <td>{formatMultiplier(season.multiplier)}</td>
              <td>{season.priority}</td>
              <td>{season.weekendSurchargeEnabled ? t('seasons.yes') : t('seasons.no')}</td>
              <td>{season.version}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
