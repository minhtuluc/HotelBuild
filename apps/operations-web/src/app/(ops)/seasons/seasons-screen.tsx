'use client';

/**
 * SCR-27 — Mùa & hệ số (UC-RATE-02, BR-RATE-05,06): tạo mùa cho một cơ sở và xem **mùa thắng từng
 * ngày** do máy chủ trả (`GET rate-calendar`, engine HB-052) — giao diện không tự so `priority`.
 * Mùa chồng nhau **được phép** (BR-RATE-05); cảnh báo chồng lấn chỉ để nhắc.
 *
 * Danh sách mùa (kèm phiên bản) đọc qua phiên nhân viên (`GET /seasons` → BFF `/api/session/sys/seasons`,
 * HB-201); máy chủ là nơi quyết mùa thắng nên giao diện chỉ hiển thị.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createRateApi, isApiError } from '@pinehill/api-client';
import type { PropertySummary, RoomTypeSummary, SeasonSummary } from '@pinehill/contracts';
import { StateSurface, color, type ScreenState } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_FILTER_ROW_STYLE,
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_TABULAR_STYLE,
  OPS_TITLE_STYLE,
  opsNoticeStyle,
} from '../../../components/editorial-styles';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { useOpsSession } from '../../../lib/ops-session';
import { t } from '../../../lib/i18n';
import { defaultRange, type GridRange } from '../../../lib/inventory-grid';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';
import {
  EMPTY_SEASON_DRAFT,
  calendarRows,
  overlappingSeasonNames,
  toCreateRequest,
  validateSeasonDraft,
  type RateCalendarEntry,
  type SeasonDraft,
} from '../../../lib/seasons';
import { SeasonListTable, WinnerTable, fetchCalendar, type SeasonTarget } from './seasons-parts';
import { SeasonEditPanel } from './season-edit-panel';
import { useSeasonEdit } from './use-season-edit';
import { useOptionalStaffSession } from '../../../session/staff-session';

export function SeasonsScreen(): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const staff = useOptionalStaffSession();
  const workingPropertyId = staff?.propertyId ?? '';
  // Mở màn ở cơ sở đang làm việc của phiên; đổi cơ sở trên thanh ngữ cảnh thì màn đi theo (TD-44).
  const [draft, setDraft] = useState<SeasonDraft>(() => ({
    ...EMPTY_SEASON_DRAFT,
    propertyId: workingPropertyId,
  }));
  useEffect(() => {
    if (workingPropertyId === '') return;
    setDraft((current) =>
      current.propertyId === workingPropertyId
        ? current
        : { ...current, propertyId: workingPropertyId, roomTypeId: '' },
    );
  }, [workingPropertyId]);
  const [range, setRange] = useState<GridRange>(() => defaultRange(new Date()));
  const [pendingRange, setPendingRange] = useState<GridRange>(() => defaultRange(new Date()));
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [roomTypes, setRoomTypes] = useState<readonly RoomTypeSummary[]>([]);
  const [entries, setEntries] = useState<readonly RateCalendarEntry[]>([]);
  const [seasons, setSeasons] = useState<readonly SeasonSummary[]>([]);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const session = useOpsSession(['/properties', '/room-types', '/seasons'], {
    onExpired: () => setState({ kind: 'forbidden' }),
  });

  const load = useCallback(
    async (target: SeasonTarget, targetRange: GridRange): Promise<void> => {
      setReadError(null);
      try {
        const loaded = await fetchCalendar(session.client, target, targetRange);
        setProperties(loaded.properties);
        setRoomTypes(loaded.roomTypes);
        setEntries(loaded.entries);
        setSeasons(loaded.seasons);
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
    [session],
  );

  // Chỉ OWNER sửa/ngừng được mùa (api.md §2.4); ngoài khung phiên (test, demo) vẫn hiện nút và để
  // máy chủ quyết — 403 được báo ngay trong khung sửa.
  const canEdit = staff === null || staff.me.role === 'OWNER';
  const [updatedName, setUpdatedName] = useState<string | null>(null);
  const seasonEdit = useSeasonEdit(session.client, async (name) => {
    setSavedName(null);
    setUpdatedName(name);
    await load(draft, range);
  });

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
      await createRateApi(session.client).createSeason(
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
    <section style={OPS_PAGE_STYLE}>
      <div style={OPS_HEADER_STYLE}>
        <h1 style={OPS_TITLE_STYLE}>{t('seasons.title')}</h1>
        <p style={OPS_INTRO_STYLE}>{t('seasons.intro')}</p>
      </div>
      <SeasonListSection
        seasons={seasons}
        updatedName={updatedName}
        canEdit={canEdit}
        seasonEdit={seasonEdit}
        onReload={() => void load(draft, range)}
      />
      <form
        data-testid="seasons-range"
        onSubmit={(event) => {
          event.preventDefault();
          setRange(pendingRange);
        }}
        className="ph-card ph-filter-row"
        style={OPS_FILTER_ROW_STYLE}
      >
        <label style={OPS_FIELD_LABEL_STYLE}>
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
        <label style={OPS_FIELD_LABEL_STYLE}>
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
        <label style={OPS_FIELD_LABEL_STYLE}>
          {t('seasons.form.from')}
          <input
            type="date"
            value={pendingRange.from}
            onChange={(event) => setPendingRange({ ...pendingRange, from: event.target.value })}
          />
        </label>
        <label style={OPS_FIELD_LABEL_STYLE}>
          {t('seasons.form.to')}
          <input
            type="date"
            value={pendingRange.to}
            onChange={(event) => setPendingRange({ ...pendingRange, to: event.target.value })}
          />
        </label>
        <button type="submit" className="ph-btn-primary" style={OPS_COMPACT_BTN_STYLE}>
          {t('seasons.form.load')}
        </button>
      </form>
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(draft, range)} />
        )}
        {savedName === null ? null : (
          <p
            role="status"
            data-testid="seasons-saved"
            style={{ ...opsNoticeStyle('success'), color: color.success, fontWeight: 500 }}
          >
            {t('seasons.saved', { name: savedName })}
          </p>
        )}
        <form
          data-testid="seasons-create"
          onSubmit={(event) => void submit(event)}
          className="ph-card ph-filter-row"
          style={OPS_FILTER_ROW_STYLE}
        >
          <label style={OPS_FIELD_LABEL_STYLE}>
            {t('seasons.form.name')}
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label style={OPS_FIELD_LABEL_STYLE}>
            {t('seasons.form.multiplier')}
            <input
              value={draft.multiplier}
              style={OPS_TABULAR_STYLE}
              onChange={(event) => setDraft({ ...draft, multiplier: event.target.value })}
            />
          </label>
          <label style={OPS_FIELD_LABEL_STYLE}>
            {t('seasons.form.priority')}
            <input
              value={draft.priority}
              style={OPS_TABULAR_STYLE}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
            />
          </label>
          <label
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              minHeight: 44,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={draft.weekendSurchargeEnabled}
              onChange={(event) =>
                setDraft({ ...draft, weekendSurchargeEnabled: event.target.checked })
              }
            />
            {t('seasons.form.weekend')}
          </label>
          <button type="submit" className="ph-btn-primary" style={OPS_COMPACT_BTN_STYLE}>
            {t('seasons.create')}
          </button>
        </form>
        {overlaps.length === 0 ? null : (
          <p
            role="alert"
            data-testid="seasons-overlap"
            style={{ ...opsNoticeStyle('warning'), color: color.warning, fontWeight: 500 }}
          >
            {t('seasons.overlap', { names: overlaps.join(', ') })}
          </p>
        )}
        {rows.length === 0 ? (
          <p style={{ margin: 0, color: color.textMuted }}>{t('state.empty.noData')}</p>
        ) : (
          <>
            <p
              role="status"
              data-testid="seasons-winner-note"
              style={{ margin: 0, fontSize: 13, color: color.textMuted }}
            >
              {t('seasons.winnerNote')}
            </p>
            <WinnerTable rows={rows} />
          </>
        )}
      </StateSurface>
    </section>
  );
}

function SeasonListSection({
  seasons,
  updatedName,
  canEdit,
  seasonEdit,
  onReload,
}: {
  seasons: readonly SeasonSummary[];
  updatedName: string | null;
  canEdit: boolean;
  seasonEdit: ReturnType<typeof useSeasonEdit>;
  onReload: () => void;
}): ReactElement {
  return (
    <>
      {updatedName === null ? null : (
        <p
          role="status"
          data-testid="seasons-updated"
          style={{ ...opsNoticeStyle('success'), color: color.success, fontWeight: 500 }}
        >
          {t('seasons.updated', { name: updatedName })}
        </p>
      )}
      {seasons.length === 0 ? (
        <p data-testid="seasons-list-empty" style={{ margin: 0, color: color.textMuted }}>
          {t('seasons.list.empty')}
        </p>
      ) : (
        <SeasonListTable
          seasons={seasons}
          onEdit={canEdit ? (season) => seasonEdit.open(season, 'edit') : undefined}
          onToggle={canEdit ? (season) => seasonEdit.open(season, 'toggle') : undefined}
        />
      )}
      {seasonEdit.edit === null ? null : (
        <SeasonEditPanel
          edit={seasonEdit.edit}
          onChange={seasonEdit.change}
          onSubmit={() => void seasonEdit.submit()}
          onCancel={seasonEdit.close}
          onReload={() => {
            seasonEdit.close();
            onReload();
          }}
        />
      )}
    </>
  );
}
