import type { FormEvent, ReactElement } from 'react';
import type { RoomSummary, RoomTypeSummary } from '@pinehill/contracts';
import { color, formatStatusWithEnum, space } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_SUBTITLE_STYLE,
  OPS_TABLE_WRAP_STYLE,
  OPS_TABULAR_STYLE,
} from '../../../components/editorial-styles';
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
    <div role="region" aria-label={t('rooms.title')} tabIndex={0} style={OPS_TABLE_WRAP_STYLE}>
      <table data-testid="rooms-table" style={OPS_TABULAR_STYLE}>
        <caption
          style={{ textAlign: 'start', padding: space.s3, fontWeight: 500, color: color.text }}
        >
          {t('rooms.title')}
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
          {sortByFloorThenCode(rooms).map((room) => {
            const connected = connectingCode(rooms, room.id);
            return (
              <tr key={room.id} data-testid={`room-${room.code}`}>
                <td style={{ fontWeight: 500 }}>{room.code}</td>
                <td>{room.floor}</td>
                <td>{typeCode(room.roomTypeId)}</td>
                <td>{formatStatusWithEnum(t(ROOM_STATUS_LABEL[room.status]), room.status)}</td>
                <td data-testid={`room-connecting-${room.code}`}>
                  {connected ?? '—'}
                  {isSymmetrical(rooms, room.id) ? null : (
                    <span
                      data-testid={`room-asymmetric-${room.code}`}
                      style={{ color: color.warning, fontWeight: 500 }}
                    >
                      {' '}
                      {t('rooms.asymmetric')}
                    </span>
                  )}
                </td>
                <td>
                  {canEdit ? (
                    <div style={{ display: 'flex', gap: space.s2, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => onAssign(room)}
                        className="ph-btn"
                        style={OPS_COMPACT_BTN_STYLE}
                      >
                        {t('rooms.assign')}
                      </button>
                      {connected === null ? null : (
                        <button
                          type="button"
                          onClick={() => onUnassign(room)}
                          className="ph-btn"
                          style={OPS_COMPACT_BTN_STYLE}
                        >
                          {t('rooms.unassign')}
                        </button>
                      )}
                    </div>
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
      className="ph-card"
      style={{ display: 'grid', gap: space.s4, maxWidth: 480, minWidth: 0 }}
    >
      <fieldset
        disabled={disabled}
        style={{ display: 'grid', gap: space.s3, border: 0, padding: 0, margin: 0 }}
      >
        <legend style={{ ...OPS_SUBTITLE_STYLE, marginBottom: space.s1 }}>
          {t('rooms.form.legend', { code: room.code, version: room.version })}
        </legend>
        <label style={OPS_FIELD_LABEL_STYLE}>
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
      <p style={{ margin: 0, fontSize: 13, color: color.textMuted }}>{t('rooms.symmetricNote')}</p>
      <div style={{ display: 'flex', gap: space.s2, flexWrap: 'wrap' }}>
        <button
          disabled={disabled}
          type="submit"
          className="ph-btn-primary"
          style={OPS_COMPACT_BTN_STYLE}
        >
          {t('rooms.form.save')}
        </button>
        <button
          disabled={disabled}
          type="button"
          onClick={onCancel}
          className="ph-btn"
          style={OPS_COMPACT_BTN_STYLE}
        >
          {t('rooms.form.cancel')}
        </button>
      </div>
    </form>
  );
}
