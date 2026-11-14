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
import {
  seasonStatus,
  type CalendarRow,
  type RateCalendarEntry,
  type SeasonDraft,
} from '../../../lib/seasons';

export interface Loaded {
  properties: readonly PropertySummary[];
  roomTypes: readonly RoomTypeSummary[];
  entries: readonly RateCalendarEntry[];
  seasons: readonly SeasonSummary[];
}

export type SeasonTarget = Pick<SeasonDraft, 'propertyId' | 'roomTypeId'>;

/** Chọn giá trị đang dùng: giữ lựa chọn cũ nếu còn hợp lệ, ngược lại lấy mục đầu tiên. */
export function pickId(preferred: string, options: readonly { id: string }[]): string {
  return options.some((option) => option.id === preferred) ? preferred : (options[0]?.id ?? '');
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

/** Danh sách mùa hiện có của cơ sở — đọc thẳng từ `GET /seasons` (AC1); OWNER thêm nút sửa / ngừng. */
export function SeasonListTable({
  seasons,
  onEdit,
  onToggle,
}: {
  seasons: readonly SeasonSummary[];
  onEdit?: ((season: SeasonSummary) => void) | undefined;
  onToggle?: ((season: SeasonSummary) => void) | undefined;
}): ReactElement {
  const actions = onEdit !== undefined && onToggle !== undefined;
  const headers = [
    t('seasons.col.name'),
    t('seasons.col.range'),
    t('seasons.col.multiplier'),
    t('seasons.col.priority'),
    t('seasons.col.weekend'),
    t('seasons.col.status'),
    t('seasons.col.version'),
    ...(actions ? [t('seasons.col.actions')] : []),
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
          {seasons.map((season) => {
            const active = seasonStatus(season) === 'ACTIVE';
            return (
              <tr
                key={season.id}
                data-testid={`season-${season.name}`}
                style={active ? undefined : { color: color.textMuted }}
              >
                <td style={{ fontWeight: 500 }}>{season.name}</td>
                <td>
                  {season.startDate} → {season.endDate}
                </td>
                <td>{formatMultiplier(season.multiplier)}</td>
                <td>{season.priority}</td>
                <td>{season.weekendSurchargeEnabled ? t('seasons.yes') : t('seasons.no')}</td>
                <td data-testid={`season-status-${season.name}`}>
                  {t(active ? 'seasons.status.ACTIVE' : 'seasons.status.INACTIVE')}
                </td>
                <td>{season.version}</td>
                {actions ? (
                  <td>
                    <div className="ph-actions" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <button type="button" className="ph-btn" onClick={() => onEdit(season)}>
                        {t('seasons.edit')}
                      </button>
                      <button
                        type="button"
                        className={active ? 'ph-btn-danger' : 'ph-btn'}
                        onClick={() => onToggle(season)}
                      >
                        {t(active ? 'seasons.deactivate' : 'seasons.activate')}
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
