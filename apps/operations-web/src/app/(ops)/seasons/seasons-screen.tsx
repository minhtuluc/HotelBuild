'use client';

/**
 * SCR-27 — Mùa & hệ số (UC-RATE-02, BR-RATE-05,06): tạo mùa cho một cơ sở và xem **mùa thắng từng
 * ngày** do máy chủ trả (`GET rate-calendar`, engine HB-052) — giao diện không tự so `priority`.
 * Mùa chồng nhau **được phép** (BR-RATE-05); cảnh báo chồng lấn chỉ để nhắc.
 *
 * Danh sách mùa (kèm phiên bản) cần tuyến đọc `GET /seasons` chưa có trong api.md §2.4 — phần đó
 * đang chờ lead chốt nên màn hình ghi rõ "chưa hỗ trợ", không bịa danh sách (xem PR: AC1 BLOCKED).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createPropertyApi, createRateApi, isApiError } from '@pinehill/api-client';
import type { PropertySummary, RoomTypeSummary } from '@pinehill/contracts';
import {
  StateSurface,
  formatMoney,
  formatStatusWithEnum,
  type ScreenState,
} from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { defaultRange, type GridRange } from '../../../lib/inventory-grid';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';
import {
  EMPTY_SEASON_DRAFT,
  calendarRows,
  overlappingSeasonNames,
  toCreateRequest,
  validateSeasonDraft,
  type CalendarRow,
  type RateCalendarEntry,
  type SeasonDraft,
} from '../../../lib/seasons';

interface Loaded {
  properties: readonly PropertySummary[];
  roomTypes: readonly RoomTypeSummary[];
  entries: readonly RateCalendarEntry[];
}

type SeasonTarget = Pick<SeasonDraft, 'propertyId' | 'roomTypeId'>;

/** Chọn giá trị đang dùng: giữ lựa chọn cũ nếu còn hợp lệ, ngược lại lấy mục đầu tiên. */
function pickId(preferred: string, options: readonly { id: string }[]): string {
  return preferred === '' ? (options[0]?.id ?? '') : preferred;
}

async function fetchCalendar(
  baseUrl: string,
  draft: SeasonTarget,
  range: GridRange,
): Promise<Loaded> {
  const client = opsApiClient(baseUrl);
  const propertyApi = createPropertyApi(client);
  const properties = (await propertyApi.list()).data.data;
  const propertyId = pickId(draft.propertyId, properties);
  const roomTypes =
    propertyId === '' ? [] : (await propertyApi.listRoomTypes({ propertyId })).data.data;
  const roomTypeId = pickId(draft.roomTypeId, roomTypes);
  const entries =
    roomTypeId === ''
      ? []
      : (
          await createRateApi(client).rateCalendar(roomTypeId, {
            from: range.from,
            to: range.to,
          })
        ).data.entries;
  return { properties, roomTypes, entries };
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

function WinnerTable({ rows }: { rows: readonly CalendarRow[] }): ReactElement {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="seasons-calendar" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
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
              <th
                key={label}
                scope="col"
                style={{ textAlign: 'start', borderBottom: '1px solid var(--color-border)' }}
              >
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

export function SeasonsScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [draft, setDraft] = useState<SeasonDraft>(EMPTY_SEASON_DRAFT);
  const [range, setRange] = useState<GridRange>(() => defaultRange(new Date()));
  const [pendingRange, setPendingRange] = useState<GridRange>(() => defaultRange(new Date()));
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [roomTypes, setRoomTypes] = useState<readonly RoomTypeSummary[]>([]);
  const [entries, setEntries] = useState<readonly RateCalendarEntry[]>([]);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [readError, setReadError] = useState<unknown>(null);

  const load = useCallback(
    async (target: SeasonTarget, targetRange: GridRange): Promise<void> => {
      setReadError(null);
      try {
        const loaded = await fetchCalendar(baseUrl, target, targetRange);
        setProperties(loaded.properties);
        setRoomTypes(loaded.roomTypes);
        setEntries(loaded.entries);
        setDraft((current) => ({
          ...current,
          propertyId: loaded.properties.some((item) => item.id === current.propertyId)
            ? current.propertyId
            : (loaded.properties[0]?.id ?? ''),
          roomTypeId: loaded.roomTypes.some((item) => item.id === current.roomTypeId)
            ? current.roomTypeId
            : (loaded.roomTypes[0]?.id ?? ''),
        }));
        setState({ kind: 'ready' });
      } catch (caught) {
        const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
        if (mapped !== undefined) {
          setState(mapped);
          return;
        }
        setReadError(caught);
        setState({ kind: 'ready' });
      }
    },
    [baseUrl],
  );

  const { propertyId: draftProperty, roomTypeId: draftRoomType } = draft;
  useEffect(() => {
    if (forced !== undefined) return;
    void load({ propertyId: draftProperty, roomTypeId: draftRoomType }, range);
  }, [forced, load, draftProperty, draftRoomType, range]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const issues = validateSeasonDraft({ ...draft, startDate: range.from, endDate: range.to });
    if (issues.length > 0) {
      setState({ kind: 'validationError', details: issues });
      return;
    }
    try {
      await createRateApi(opsApiClient(baseUrl)).createSeason(
        toCreateRequest({ ...draft, startDate: range.from, endDate: range.to }),
      );
      setSavedName(draft.name.trim());
      await load(draft, range);
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: '—',
          onReload: () => void load(draft, range),
          onLookup: () => void load(draft, range),
        }),
      );
    }
  };

  if (forced !== undefined) {
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  }

  const rows = calendarRows(entries);
  const overlaps = overlappingSeasonNames(entries, draft.name);

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('seasons.title')}</h1>
      <p style={{ margin: 0 }}>{t('seasons.intro')}</p>
      <p data-testid="seasons-list-unsupported" style={{ margin: 0 }}>
        {t('seasons.listUnsupported')}
      </p>
      <form
        data-testid="seasons-range"
        onSubmit={(event) => {
          event.preventDefault();
          setRange(pendingRange);
        }}
        style={{
          display: 'flex',
          gap: 'var(--space-s2, 8px)',
          flexWrap: 'wrap',
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'grid', gap: 4 }}>
          {t('seasons.form.property')}
          <select
            value={draft.propertyId}
            onChange={(event) => setDraft({ ...draft, propertyId: event.target.value })}
          >
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('seasons.form.roomType')}
          <select
            value={draft.roomTypeId}
            onChange={(event) => setDraft({ ...draft, roomTypeId: event.target.value })}
          >
            {roomTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.code}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('seasons.form.from')}
          <input
            type="date"
            value={pendingRange.from}
            onChange={(event) => setPendingRange({ ...pendingRange, from: event.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('seasons.form.to')}
          <input
            type="date"
            value={pendingRange.to}
            onChange={(event) => setPendingRange({ ...pendingRange, to: event.target.value })}
          />
        </label>
        <button type="submit" style={{ minHeight: 44 }}>
          {t('seasons.form.load')}
        </button>
      </form>
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(draft, range)} />
        )}
        {savedName === null ? null : (
          <p role="status" data-testid="seasons-saved" style={{ margin: 0 }}>
            {t('seasons.saved', { name: savedName })}
          </p>
        )}
        <form
          data-testid="seasons-create"
          onSubmit={(event) => void submit(event)}
          style={{
            display: 'flex',
            gap: 'var(--space-s2, 8px)',
            flexWrap: 'wrap',
            alignItems: 'end',
          }}
        >
          <label style={{ display: 'grid', gap: 4 }}>
            {t('seasons.form.name')}
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('seasons.form.multiplier')}
            <input
              value={draft.multiplier}
              onChange={(event) => setDraft({ ...draft, multiplier: event.target.value })}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('seasons.form.priority')}
            <input
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
            />
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={draft.weekendSurchargeEnabled}
              onChange={(event) =>
                setDraft({ ...draft, weekendSurchargeEnabled: event.target.checked })
              }
            />
            {t('seasons.form.weekend')}
          </label>
          <button type="submit" style={{ minHeight: 44 }}>
            {t('seasons.create')}
          </button>
        </form>
        {overlaps.length === 0 ? null : (
          <p role="alert" data-testid="seasons-overlap" style={{ margin: 0 }}>
            {t('seasons.overlap', { names: overlaps.join(', ') })}
          </p>
        )}
        {rows.length === 0 ? (
          <p>{t('state.empty.noData')}</p>
        ) : (
          <>
            <p role="status" data-testid="seasons-winner-note" style={{ margin: 0 }}>
              {t('seasons.winnerNote')}
            </p>
            <WinnerTable rows={rows} />
          </>
        )}
      </StateSurface>
    </section>
  );
}
