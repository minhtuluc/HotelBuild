'use client';

/**
 * SCR-20 — Loại phòng, sức chứa và sàn–trần giá (UC-PROP-02, FR-PROP-03/04).
 * Đọc `GET /room-types` (lọc theo cơ sở) và tạo mới bằng `POST /room-types`.
 * Cảnh báo sàn–trần ở giao diện chỉ để nhắc; máy chủ vẫn là nơi chặn (BR-RATE-03, BR-RATE-04).
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { RoomTypeSummary } from '@pinehill/contracts';
import { StateSurface, formatMoney } from '@pinehill/ui-web';
import { useForcedState } from '../../../components/forced-state';
import { t } from '../../../lib/i18n';
import { roomTypePriceWarnings, type RoomTypePriceWarning } from '../../../lib/room-type-warnings';
import { RoomTypeForm } from './room-type-form';
import { EMPTY_ROOM_TYPE_DRAFT, toRoomTypeRequest, type RoomTypeDraft } from './room-type-draft';

import { useAdmin } from '../admin-commands/use-admin';
import { AdminPanels } from '../admin-commands/panels';

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

function useRoomTypeEditor(enabled: boolean) {
  const { controller, state } = useAdmin('room-type', enabled);
  const [draft, setDraft] = useState<RoomTypeDraft | null>(null);
  useEffect(() => {
    if (!state.canWrite) setDraft(null);
  }, [state.canWrite]);
  useEffect(() => {
    if (state.receipt?.kind === 'room-type-create') setDraft(null);
  }, [state.receipt]);
  const properties = state.data?.properties ?? [];
  const rows = state.data?.roomTypes ?? [];
  const created = state.receipt?.kind === 'room-type-create' ? state.receipt.data.code : null;
  const submit = async () => {
    if (!draft || !controller) return;
    const parsed = toRoomTypeRequest(draft);
    if ('invalid' in parsed) {
      controller.validation(parsed.invalid.map((field) => ({ field, issue: 'REQUIRED' })));
      return;
    }
    await controller.save({ kind: 'room-type-create', body: parsed.input });
  };
  return { controller, state, draft, setDraft, properties, rows, created, submit };
}
type RoomTypeModel = ReturnType<typeof useRoomTypeEditor>;
function RoomTypeBody({ model }: { model: RoomTypeModel }): ReactElement {
  const { controller, state, created, rows, draft, properties, setDraft, submit } = model;
  return (
    <>
      {created ? (
        <p role="status" data-testid="create-success" style={{ margin: 0 }}>
          {t('roomTypes.created', { code: created })}
        </p>
      ) : null}
      {rows.length ? <RoomTypeTable rows={rows} /> : null}
      {draft ? (
        <RoomTypeForm
          draft={draft}
          properties={properties}
          disabled={state.busy || !controller?.canStart()}
          onChange={setDraft}
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void submit();
          }}
          onCancel={() => {
            setDraft(null);
            controller?.clearValidation();
          }}
        />
      ) : null}
    </>
  );
}
export function RoomTypesScreen(): ReactElement {
  const forced = useForcedState();
  const model = useRoomTypeEditor(forced === undefined);
  const { state, controller, setDraft } = model;
  if (forced !== undefined)
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  return (
    <section
      style={{
        padding: 'var(--space-s6, 24px)',
        display: 'grid',
        gap: 'var(--space-s4, 16px)',
        minWidth: 0,
      }}
    >
      <h1 style={{ margin: 0 }}>{t('roomTypes.title')}</h1>
      <p style={{ margin: 0 }}>{t('roomTypes.intro')}</p>
      <div style={{ display: 'flex', gap: 'var(--space-s2, 8px)' }}>
        <button
          type="button"
          disabled={state.busy}
          onClick={() => void controller?.load()}
          style={{ minHeight: 44 }}
        >
          {t('roomTypes.reload')}
        </button>
        {state.canWrite ? (
          <button
            type="button"
            disabled={!controller?.canStart()}
            onClick={() => {
              controller?.clearValidation();
              setDraft(EMPTY_ROOM_TYPE_DRAFT);
            }}
            style={{ minHeight: 44 }}
          >
            {t('roomTypes.create')}
          </button>
        ) : null}
      </div>
      <AdminPanels state={state} controller={controller} />
      <RoomTypeBody model={model} />
    </section>
  );
}
