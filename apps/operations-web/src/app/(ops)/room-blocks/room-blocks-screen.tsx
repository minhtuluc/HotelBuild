'use client';

/**
 * SCR-22 — Khoá phòng bảo trì/ngừng bán (UC-PROP-04, BR-INV-06, BR-PROP-06): liệt kê khoá đang có,
 * cảnh báo chồng lấn **trước khi** gửi, tạo khoá (MANAGER) và gỡ khoá kèm lý do. Tồn giảm và mở
 * `OverbookingCase` khi khoá đè booking là việc của máy chủ.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createPropertyApi, isApiError } from '@pinehill/api-client';
import type { PropertySummary, RoomBlock, RoomSummary } from '@pinehill/contracts';
import { StateSurface, formatStatusWithEnum, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { businessDate } from '../../../lib/inventory-grid';
import {
  EMPTY_ROOM_BLOCK_DRAFT,
  ROOM_BLOCK_REASONS,
  conflictingBlocks,
  isRoomBlockReason,
  toCreateRequest,
  validateDraft,
  type RoomBlockDraft,
} from '../../../lib/room-blocks';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';

const REASON_LABEL: Readonly<
  Record<
    RoomBlock['reason'],
    | 'enum.roomBlockReason.MAINTENANCE'
    | 'enum.roomBlockReason.RENOVATION'
    | 'enum.roomBlockReason.OWNER_USE'
    | 'enum.roomBlockReason.DEEP_CLEAN'
  >
> = {
  MAINTENANCE: 'enum.roomBlockReason.MAINTENANCE',
  RENOVATION: 'enum.roomBlockReason.RENOVATION',
  OWNER_USE: 'enum.roomBlockReason.OWNER_USE',
  DEEP_CLEAN: 'enum.roomBlockReason.DEEP_CLEAN',
};

interface Loaded {
  properties: readonly PropertySummary[];
  propertyId: string;
  rooms: readonly RoomSummary[];
  blocks: readonly RoomBlock[];
}

async function fetchAll(baseUrl: string, propertyId: string): Promise<Loaded> {
  const api = createPropertyApi(opsApiClient(baseUrl));
  const propertyPage = await api.list();
  const properties = propertyPage.data.data;
  const chosen = propertyId === '' ? (properties[0]?.id ?? '') : propertyId;
  if (chosen === '') return { properties, propertyId: '', rooms: [], blocks: [] };
  const [roomPage, blockPage] = await Promise.all([
    api.listRooms({ propertyId: chosen }),
    api.listRoomBlocks({ propertyId: chosen }),
  ]);
  return {
    properties,
    propertyId: chosen,
    rooms: roomPage.data.data,
    blocks: blockPage.data.data,
  };
}

function BlockTable({
  blocks,
  rooms,
  onRemove,
}: {
  blocks: readonly RoomBlock[];
  rooms: readonly RoomSummary[];
  onRemove: (block: RoomBlock) => void;
}): ReactElement {
  const roomCode = (roomId: string): string =>
    rooms.find((room) => room.id === roomId)?.code ?? roomId;
  const headers = [
    t('roomBlocks.col.room'),
    t('roomBlocks.col.range'),
    t('roomBlocks.col.reason'),
    t('roomBlocks.col.note'),
    t('roomBlocks.col.actions'),
  ];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="room-blocks-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
          {t('roomBlocks.title')}
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
          {blocks.map((block) => (
            <tr key={block.id} data-testid={`block-${roomCode(block.roomId)}-${block.startDate}`}>
              <td>{roomCode(block.roomId)}</td>
              <td>
                {block.startDate} → {block.endDate}
              </td>
              <td>{formatStatusWithEnum(t(REASON_LABEL[block.reason]), block.reason)}</td>
              <td>{block.note ?? ''}</td>
              <td>
                <button type="button" onClick={() => onRemove(block)} style={{ minHeight: 44 }}>
                  {t('roomBlocks.remove')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RoomBlocksScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [rooms, setRooms] = useState<readonly RoomSummary[]>([]);
  const [blocks, setBlocks] = useState<readonly RoomBlock[]>([]);
  const [draft, setDraft] = useState<RoomBlockDraft>(() => ({
    ...EMPTY_ROOM_BLOCK_DRAFT,
    startDate: businessDate(new Date()),
  }));
  const [removing, setRemoving] = useState<RoomBlock | null>(null);
  const [removeReason, setRemoveReason] = useState('');
  const [readError, setReadError] = useState<unknown>(null);

  const load = useCallback(
    async (target: string): Promise<void> => {
      setReadError(null);
      try {
        const loaded = await fetchAll(baseUrl, target);
        setProperties(loaded.properties);
        setRooms(loaded.rooms);
        setBlocks(loaded.blocks);
        if (loaded.propertyId !== propertyId) {
          setPropertyId(loaded.propertyId);
          return;
        }
        setState(
          loaded.blocks.length === 0
            ? { kind: 'empty', reason: 'noData', canCreate: false }
            : { kind: 'ready' },
        );
      } catch (caught) {
        const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
        if (mapped !== undefined) {
          setState(mapped);
          return;
        }
        // Giữ nguyên bảng đã có; băng lỗi nói rõ chưa đọc được thay vì hiện "chưa có dữ liệu".
        setReadError(caught);
        setState({ kind: 'ready' });
      }
    },
    [baseUrl, propertyId],
  );

  useEffect(() => {
    if (forced !== undefined) return;
    void load(propertyId);
  }, [forced, load, propertyId]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const issues = validateDraft(draft);
    if (issues.length > 0) {
      setState({ kind: 'validationError', details: issues });
      return;
    }
    try {
      await createPropertyApi(opsApiClient(baseUrl)).createRoomBlock(toCreateRequest(draft));
      setDraft({ ...EMPTY_ROOM_BLOCK_DRAFT, startDate: businessDate(new Date()) });
      await load(propertyId);
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: '—',
          onReload: () => void load(propertyId),
          onLookup: () => void load(propertyId),
        }),
      );
    }
  };

  const remove = async (): Promise<void> => {
    if (removing === null || removeReason.trim() === '') {
      setState({ kind: 'validationError', details: [{ field: 'reason', issue: 'REQUIRED' }] });
      return;
    }
    try {
      await createPropertyApi(opsApiClient(baseUrl)).deleteRoomBlock(removing.id, removeReason);
      setRemoving(null);
      setRemoveReason('');
      await load(propertyId);
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: '—',
          onReload: () => void load(propertyId),
          onLookup: () => void load(propertyId),
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

  const conflicts = conflictingBlocks(draft, blocks);

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('roomBlocks.title')}</h1>
      <p style={{ margin: 0 }}>{t('roomBlocks.intro')}</p>
      <label style={{ display: 'grid', gap: 4, maxWidth: 320 }}>
        {t('roomBlocks.form.property')}
        <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </label>
      <form
        data-testid="room-block-form"
        onSubmit={(event) => void submit(event)}
        style={{
          display: 'flex',
          gap: 'var(--space-s2, 8px)',
          flexWrap: 'wrap',
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'grid', gap: 4 }}>
          {t('roomBlocks.form.room')}
          <select
            value={draft.roomId}
            onChange={(event) => setDraft({ ...draft, roomId: event.target.value })}
          >
            <option value="">{t('roomBlocks.form.roomPlaceholder')}</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.code}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('roomBlocks.form.from')}
          <input
            type="date"
            value={draft.startDate}
            onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('roomBlocks.form.to')}
          <input
            type="date"
            value={draft.endDate}
            onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('roomBlocks.form.reason')}
          <select
            value={draft.reason}
            onChange={(event) => {
              const value = event.target.value;
              if (isRoomBlockReason(value)) setDraft({ ...draft, reason: value });
            }}
          >
            {ROOM_BLOCK_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {t(REASON_LABEL[reason])}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('roomBlocks.form.note')}
          <input
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
        </label>
        <button type="submit" style={{ minHeight: 44 }}>
          {t('roomBlocks.create')}
        </button>
      </form>
      {conflicts.length === 0 ? null : (
        <p role="alert" data-testid="room-block-overlap" style={{ margin: 0 }}>
          {t('roomBlocks.overlap', { count: conflicts.length })}
        </p>
      )}
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(propertyId)} />
        )}
        {blocks.length === 0 ? null : (
          <BlockTable blocks={blocks} rooms={rooms} onRemove={setRemoving} />
        )}
        {removing === null ? null : (
          <form
            data-testid="room-block-remove"
            onSubmit={(event) => {
              event.preventDefault();
              void remove();
            }}
            style={{ display: 'flex', gap: 'var(--space-s2, 8px)', alignItems: 'end' }}
          >
            <label style={{ display: 'grid', gap: 4 }}>
              {t('roomBlocks.form.removeReason')}
              <input
                value={removeReason}
                onChange={(event) => setRemoveReason(event.target.value)}
              />
            </label>
            <button type="submit" style={{ minHeight: 44 }}>
              {t('roomBlocks.removeConfirm')}
            </button>
          </form>
        )}
      </StateSurface>
    </section>
  );
}
