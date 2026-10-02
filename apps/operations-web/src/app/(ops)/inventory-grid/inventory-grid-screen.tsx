'use client';

/**
 * SCR-24 — Lưới tồn phòng theo ngày (UC-INV-01, BR-INV-01, NFR-PERF-05): mỗi hàng là một loại phòng,
 * mỗi cột là một ngày trong khoảng đã chọn, ô hiện tồn công bố `max(0, pool)` kèm ký hiệu trạng thái.
 * Đổi khoảng ngày chỉ tải lại dữ liệu, **không** nạp lại trang.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { createInventoryApi, createPropertyApi, isApiError } from '@pinehill/api-client';
import type { PropertySummary, RoomTypeSummary } from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import {
  MAX_GRID_DAYS,
  dayCount,
  defaultRange,
  gridDates,
  type CellPosition,
  type GridRange,
} from '../../../lib/inventory-grid';
import { readFailureState } from '../../../lib/screen-state';
import { GridLegend, GridTable, type GridRow } from './grid-table';

interface LoadedGrid {
  properties: readonly PropertySummary[];
  propertyId: string;
  roomTypes: readonly RoomTypeSummary[];
  rows: readonly GridRow[];
}

/** Đọc cơ sở, loại phòng và lưới tồn của từng loại phòng trong một khoảng. */
async function fetchGrid(
  baseUrl: string,
  propertyId: string,
  range: GridRange,
): Promise<LoadedGrid> {
  const api = createPropertyApi(opsApiClient(baseUrl));
  const propertyPage = await api.list();
  const properties = propertyPage.data.data;
  const chosen = propertyId === '' ? (properties[0]?.id ?? '') : propertyId;
  if (chosen === '') return { properties, propertyId: '', roomTypes: [], rows: [] };
  const typePage = await api.listRoomTypes({ propertyId: chosen });
  const inventory = createInventoryApi(opsApiClient(baseUrl));
  const grids = await Promise.all(
    typePage.data.data.map((type) =>
      inventory.grid({
        propertyId: chosen,
        roomTypeId: type.id,
        from: range.from,
        to: range.to,
      }),
    ),
  );
  const rows: readonly GridRow[] = typePage.data.data.map((type, index) => ({
    roomTypeId: type.id,
    code: type.code,
    cells: grids[index]?.data.cells ?? [],
  }));
  return { properties, propertyId: chosen, roomTypes: typePage.data.data, rows };
}

export function InventoryGridScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [range, setRange] = useState<GridRange>(() => defaultRange(new Date()));
  const [pending, setPending] = useState<GridRange>(() => defaultRange(new Date()));
  const [roomTypes, setRoomTypes] = useState<readonly RoomTypeSummary[]>([]);
  const [rows, setRows] = useState<readonly GridRow[]>([]);
  const [focus, setFocus] = useState<CellPosition>({ row: 0, col: 0 });
  const [readError, setReadError] = useState<unknown>(null);

  const load = useCallback(
    async (target: { propertyId: string; range: GridRange }): Promise<void> => {
      setReadError(null);
      const dates = gridDates(target.range.from, target.range.to);
      if (dates.length === 0 || dates.length > MAX_GRID_DAYS) {
        setState({ kind: 'validationError', details: [{ field: 'to', issue: 'RANGE_INVALID' }] });
        return;
      }
      try {
        const loaded = await fetchGrid(baseUrl, target.propertyId, target.range);
        setProperties(loaded.properties);
        setRoomTypes(loaded.roomTypes);
        setRows(loaded.rows);
        setFocus({ row: 0, col: 0 });
        if (loaded.propertyId !== propertyId) {
          setPropertyId(loaded.propertyId);
          return;
        }
        setState(
          loaded.rows.length === 0
            ? { kind: 'empty', reason: 'noData', canCreate: false }
            : { kind: 'ready' },
        );
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
    [baseUrl, propertyId],
  );

  useEffect(() => {
    if (forced !== undefined) return;
    void load({ propertyId, range });
  }, [forced, load, propertyId, range]);

  if (forced !== undefined) {
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  }

  const dates = gridDates(range.from, range.to);
  const pendingDays = dayCount(pending.from, pending.to);

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('grid.title')}</h1>
      <p style={{ margin: 0 }}>{t('grid.intro')}</p>
      <form
        data-testid="grid-controls"
        onSubmit={(event) => {
          event.preventDefault();
          setRange(pending);
        }}
        style={{
          display: 'flex',
          gap: 'var(--space-s2, 8px)',
          flexWrap: 'wrap',
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'grid', gap: 4 }}>
          {t('grid.form.property')}
          <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('grid.form.from')}
          <input
            type="date"
            value={pending.from}
            onChange={(event) => setPending({ ...pending, from: event.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('grid.form.to')}
          <input
            type="date"
            value={pending.to}
            onChange={(event) => setPending({ ...pending, to: event.target.value })}
          />
        </label>
        <button type="submit" style={{ minHeight: 44 }}>
          {t('grid.form.load')}
        </button>
      </form>
      {pendingDays > MAX_GRID_DAYS ? (
        <p role="alert">{t('grid.rangeTooLong', { max: MAX_GRID_DAYS })}</p>
      ) : null}
      <GridLegend />
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load({ propertyId, range })} />
        )}
        {rows.length === 0 ? null : (
          <>
            <p role="status" data-testid="grid-updated" style={{ margin: 0 }}>
              {t('grid.updated', { from: range.from, to: range.to, roomTypes: roomTypes.length })}
            </p>
            <GridTable dates={dates} rows={rows} focus={focus} onFocusChange={setFocus} />
          </>
        )}
      </StateSurface>
    </section>
  );
}
