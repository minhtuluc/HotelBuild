'use client';

/**
 * SCR-20 — Loại phòng, sức chứa và sàn–trần giá (UC-PROP-02, FR-PROP-03/04).
 * Đọc `GET /room-types` (lọc theo cơ sở) và tạo mới bằng `POST /room-types`.
 * Cảnh báo sàn–trần ở giao diện chỉ để nhắc; máy chủ vẫn là nơi chặn (BR-RATE-03, BR-RATE-04).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createPropertyApi, isApiError } from '@pinehill/api-client';
import type { PropertySummary, RoomTypeSummary } from '@pinehill/contracts';
import { StateSurface, formatMoney, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';
import { roomTypePriceWarnings, type RoomTypePriceWarning } from '../../../lib/room-type-warnings';
import { RoomTypeForm } from './room-type-form';
import { EMPTY_ROOM_TYPE_DRAFT, toRoomTypeRequest, type RoomTypeDraft } from './room-type-draft';

const WARNING_LABELS: Readonly<Record<RoomTypePriceWarning, string>> = {
  floorAboveCeiling: t('roomTypes.warn.floorAboveCeiling'),
  baseBelowFloor: t('roomTypes.warn.baseBelowFloor'),
  baseAboveCeiling: t('roomTypes.warn.baseAboveCeiling'),
};

function RoomTypeTable({ rows }: { rows: readonly RoomTypeSummary[] }): ReactElement {
  const headers = [
    t('roomTypes.col.code'),
    t('roomTypes.col.capacity'),
    t('roomTypes.col.base'),
    t('roomTypes.col.floor'),
    t('roomTypes.col.ceiling'),
    t('roomTypes.col.shared'),
    t('roomTypes.col.version'),
  ];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="room-types-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
          {t('roomTypes.title')}
        </caption>
        <thead>
          <tr>
            {headers.map((label) => (
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
          {rows.map((row) => {
            const warnings = roomTypePriceWarnings(row);
            return (
              <tr key={row.id} data-testid={`room-type-${row.code}`}>
                <td>{row.code}</td>
                <td>
                  {row.capacityAdults} / {row.capacityChildren}
                </td>
                <td>{formatMoney(row.basePrice)}</td>
                <td>{formatMoney(row.minPrice)}</td>
                <td>{formatMoney(row.maxPrice)}</td>
                <td>{row.allowShared ? '✓' : '—'}</td>
                <td>{row.version}</td>
                <td data-testid={`room-type-warning-${row.code}`}>
                  {warnings.map((warning) => WARNING_LABELS[warning]).join(' ')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RoomTypesScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [rows, setRows] = useState<readonly RoomTypeSummary[]>([]);
  const [draft, setDraft] = useState<RoomTypeDraft | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [readError, setReadError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    setReadError(null);
    try {
      const api = createPropertyApi(opsApiClient(baseUrl));
      const [propertyPage, roomTypePage] = await Promise.all([api.list(), api.listRoomTypes()]);
      setProperties(propertyPage.data.data);
      setRows(roomTypePage.data.data);
      setState(
        roomTypePage.data.data.length === 0
          ? {
              kind: 'empty',
              reason: 'noData',
              canCreate: true,
              onCreate: () => setDraft(EMPTY_ROOM_TYPE_DRAFT),
            }
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
  }, [baseUrl]);

  useEffect(() => {
    if (forced !== undefined) return;
    void load();
  }, [forced, load]);

  const submit = async (): Promise<void> => {
    if (draft === null) return;
    const parsed = toRoomTypeRequest(draft);
    if ('invalid' in parsed) {
      setState({
        kind: 'validationError',
        details: parsed.invalid.map((field) => ({ field, issue: 'REQUIRED' })),
      });
      return;
    }
    try {
      const createdRoomType = await createPropertyApi(opsApiClient(baseUrl)).createRoomType(
        parsed.input,
      );
      setCreated(createdRoomType.data.code);
      setDraft(null);
      await load();
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: 'mới',
          onReload: () => void load(),
          onLookup: () => void load(),
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

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('roomTypes.title')}</h1>
      <p style={{ margin: 0 }}>{t('roomTypes.intro')}</p>
      <div style={{ display: 'flex', gap: 'var(--space-s2, 8px)' }}>
        <button
          type="button"
          onClick={() => {
            // Mốc "cập nhật lúc" chỉ để hiển thị ở giao diện, không phải thời gian nghiệp vụ.
            setState({ kind: 'refreshing', updatedAt: new Date().toISOString(), stale: false });
            void load();
          }}
          style={{ minHeight: 44 }}
        >
          {t('roomTypes.reload')}
        </button>
        <button
          type="button"
          onClick={() => {
            setCreated(null);
            setDraft(EMPTY_ROOM_TYPE_DRAFT);
          }}
          style={{ minHeight: 44 }}
        >
          {t('roomTypes.create')}
        </button>
      </div>
      <StateSurface state={state}>
        {created === null ? null : (
          <p role="status" data-testid="create-success" style={{ margin: 0 }}>
            {t('roomTypes.created', { code: created })}
          </p>
        )}
        {readError === null ? null : <ScreenAlert error={readError} onRetry={() => void load()} />}
        {rows.length === 0 ? null : <RoomTypeTable rows={rows} />}
        {draft === null ? null : (
          <RoomTypeForm
            draft={draft}
            properties={properties}
            onChange={setDraft}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void submit();
            }}
            onCancel={() => setDraft(null)}
          />
        )}
      </StateSurface>
    </section>
  );
}
