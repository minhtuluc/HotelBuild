import type { FormEvent, ReactElement } from 'react';
import type { RoomBlock, RoomSummary } from '@pinehill/contracts';
import { formatStatusWithEnum } from '@pinehill/ui-web';
import { t } from '../../../lib/i18n';
import {
  ROOM_BLOCK_REASONS,
  isRoomBlockReason,
  type RoomBlockDraft,
} from '../../../lib/room-blocks';
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

export function BlockTable({
  blocks,
  rooms,
  onRemove,
  canRemove,
}: {
  blocks: readonly RoomBlock[];
  rooms: readonly RoomSummary[];
  onRemove: (block: RoomBlock) => void;
  canRemove: boolean;
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
    <div
      role="region"
      aria-label={t('roomBlocks.title')}
      tabIndex={0}
      style={{ overflowX: 'auto' }}
    >
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
                {canRemove ? (
                  <button type="button" onClick={() => onRemove(block)} style={{ minHeight: 44 }}>
                    {t('roomBlocks.remove')}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BlockForm({
  draft,
  rooms,
  disabled,
  onChange,
  onSubmit,
}: {
  draft: RoomBlockDraft;
  rooms: readonly RoomSummary[];
  disabled: boolean;
  onChange: (draft: RoomBlockDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): ReactElement {
  return (
    <form
      data-testid="room-block-form"
      onSubmit={onSubmit}
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
          disabled={disabled}
          value={draft.roomId}
          onChange={(event) => onChange({ ...draft, roomId: event.target.value })}
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
          disabled={disabled}
          type="date"
          value={draft.startDate}
          onChange={(event) => onChange({ ...draft, startDate: event.target.value })}
        />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('roomBlocks.form.to')}
        <input
          disabled={disabled}
          type="date"
          value={draft.endDate}
          onChange={(event) => onChange({ ...draft, endDate: event.target.value })}
        />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {t('roomBlocks.form.reason')}
        <select
          disabled={disabled}
          value={draft.reason}
          onChange={(event) => {
            const value = event.target.value;
            if (isRoomBlockReason(value)) onChange({ ...draft, reason: value });
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
          disabled={disabled}
          maxLength={500}
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
        />
      </label>
      <button type="submit" disabled={disabled} style={{ minHeight: 44 }}>
        {t('roomBlocks.create')}
      </button>
    </form>
  );
}
