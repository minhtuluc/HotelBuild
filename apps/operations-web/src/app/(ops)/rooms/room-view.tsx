import type { FormEvent, ReactElement } from 'react';
import type { RoomSummary, RoomTypeSummary } from '@pinehill/contracts';
import { formatStatusWithEnum } from '@pinehill/ui-web';
import { t } from '../../../lib/i18n';
import { connectingCode, isSymmetrical, sortByFloorThenCode } from '../../../lib/room-pairing';
const ROOM_STATUS_LABEL: Readonly<
  Record<
    RoomSummary['status'],
    'enum.roomStatus.ACTIVE' | 'enum.roomStatus.MAINTENANCE' | 'enum.roomStatus.INACTIVE'
  >
> = {
  ACTIVE: 'enum.roomStatus.ACTIVE',
  MAINTENANCE: 'enum.roomStatus.MAINTENANCE',
  INACTIVE: 'enum.roomStatus.INACTIVE',
};

export function RoomTable({
  rooms,
  roomTypes,
  onAssign,
  onUnassign,
  canEdit,
}: {
  canEdit: boolean;
  rooms: readonly RoomSummary[];
  roomTypes: readonly RoomTypeSummary[];
  onAssign: (room: RoomSummary) => void;
  onUnassign: (room: RoomSummary) => void;
}): ReactElement {
  const typeCode = (roomTypeId: string): string =>
    roomTypes.find((item) => item.id === roomTypeId)?.code ?? roomTypeId;
  const headers = [
    t('rooms.col.code'),
    t('rooms.col.floor'),
    t('rooms.col.type'),
    t('rooms.col.status'),
    t('rooms.col.connecting'),
    t('rooms.col.actions'),
  ];
  return (
    <div role="region" aria-label={t('rooms.title')} tabIndex={0} style={{ overflowX: 'auto' }}>
      <table data-testid="rooms-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
          {t('rooms.title')}
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
          {sortByFloorThenCode(rooms).map((room) => {
            const connected = connectingCode(rooms, room.id);
            return (
              <tr key={room.id} data-testid={`room-${room.code}`}>
                <td>{room.code}</td>
                <td>{room.floor}</td>
                <td>{typeCode(room.roomTypeId)}</td>
                <td>{formatStatusWithEnum(t(ROOM_STATUS_LABEL[room.status]), room.status)}</td>
                <td data-testid={`room-connecting-${room.code}`}>
                  {connected ?? '—'}
                  {isSymmetrical(rooms, room.id) ? null : (
                    <span data-testid={`room-asymmetric-${room.code}`}>
                      {' '}
                      {t('rooms.asymmetric')}
                    </span>
                  )}
                </td>
                <td>
                  {canEdit ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => onAssign(room)}
                        style={{ minHeight: 44 }}
                      >
                        {t('rooms.assign')}
                      </button>
                      {connected === null ? null : (
                        <button
                          type="button"
                          onClick={() => onUnassign(room)}
                          style={{ minHeight: 44 }}
                        >
                          {t('rooms.unassign')}
                        </button>
                      )}
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AssignForm({
  room,
  candidates,
  targetId,
  onChange,
  onSubmit,
  onCancel,
  disabled,
}: {
  disabled: boolean;
  room: RoomSummary;
  candidates: readonly RoomSummary[];
  targetId: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <form
      data-testid="assign-form"
      onSubmit={onSubmit}
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)', maxWidth: 420 }}
    >
      <fieldset
        disabled={disabled}
        style={{ display: 'grid', gap: 'var(--space-s2, 8px)', border: 0, padding: 0 }}
      >
        <legend>{t('rooms.form.legend', { code: room.code, version: room.version })}</legend>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('rooms.form.target')}
          <select value={targetId} onChange={(event) => onChange(event.target.value)}>
            <option value="">—</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <p style={{ margin: 0 }}>{t('rooms.symmetricNote')}</p>
      <div style={{ display: 'flex', gap: 'var(--space-s2, 8px)' }}>
        <button disabled={disabled} type="submit" style={{ minHeight: 44 }}>
          {t('rooms.form.save')}
        </button>
        <button disabled={disabled} type="button" onClick={onCancel} style={{ minHeight: 44 }}>
          {t('rooms.form.cancel')}
        </button>
      </div>
    </form>
  );
}
