'use client';

/**
 * SCR-21 — Sơ đồ buồng & phòng vật lý (UC-PROP-03, FR-PROP-05) và gán/gỡ phòng thông nhau (BR-OVER-15).
 * Sau mỗi lệnh ghi, màn hình **đọc lại** danh sách: liên kết hai chiều do máy chủ bảo đảm, giao diện
 * chỉ hiển thị và cảnh báo khi dữ liệu trả về không đối xứng.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createPropertyApi, isApiError } from '@pinehill/api-client';
import type { RoomSummary, RoomTypeSummary } from '@pinehill/contracts';
import { StateSurface, formatStatusWithEnum, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import {
  connectingCode,
  isSymmetrical,
  pairingCandidates,
  sortByFloorThenCode,
} from '../../../lib/room-pairing';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';

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

function RoomTable({
  rooms,
  roomTypes,
  onAssign,
  onUnassign,
}: {
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
    <div style={{ overflowX: 'auto' }}>
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
                  <button type="button" onClick={() => onAssign(room)} style={{ minHeight: 44 }}>
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AssignForm({
  room,
  candidates,
  targetId,
  onChange,
  onSubmit,
  onCancel,
}: {
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
      <fieldset style={{ display: 'grid', gap: 'var(--space-s2, 8px)', border: 0, padding: 0 }}>
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
        <button type="submit" style={{ minHeight: 44 }}>
          {t('rooms.form.save')}
        </button>
        <button type="button" onClick={onCancel} style={{ minHeight: 44 }}>
          {t('rooms.form.cancel')}
        </button>
      </div>
    </form>
  );
}

export function RoomsScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [rooms, setRooms] = useState<readonly RoomSummary[]>([]);
  const [roomTypes, setRoomTypes] = useState<readonly RoomTypeSummary[]>([]);
  const [assigning, setAssigning] = useState<RoomSummary | null>(null);
  const [targetId, setTargetId] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [readError, setReadError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    setReadError(null);
    try {
      const api = createPropertyApi(opsApiClient(baseUrl));
      const [roomPage, typePage] = await Promise.all([api.listRooms(), api.listRoomTypes()]);
      setRooms(roomPage.data.data);
      setRoomTypes(typePage.data.data);
      setState(
        roomPage.data.data.length === 0
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
  }, [baseUrl]);

  useEffect(() => {
    if (forced !== undefined) return;
    void load();
  }, [forced, load]);

  const write = async (room: RoomSummary, nextTargetId: string | null): Promise<void> => {
    try {
      const updated = await createPropertyApi(opsApiClient(baseUrl)).setConnectingRoom(
        room.id,
        { connectingRoomId: nextTargetId },
        `"${room.version}"`,
      );
      setAssigning(null);
      setTargetId('');
      // Đọc lại: liên kết hai chiều do máy chủ bảo đảm, giao diện không tự suy đoán phòng đối ứng.
      await load();
      setSaved(updated.data.code);
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: String(room.version),
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
      <h1 style={{ margin: 0 }}>{t('rooms.title')}</h1>
      <p style={{ margin: 0 }}>{t('rooms.intro')}</p>
      <button
        type="button"
        onClick={() => {
          // Mốc "cập nhật lúc" chỉ để hiển thị ở giao diện, không phải thời gian nghiệp vụ.
          setState({ kind: 'refreshing', updatedAt: new Date().toISOString(), stale: false });
          void load();
        }}
        style={{ minHeight: 44, justifySelf: 'start' }}
      >
        {t('rooms.reload')}
      </button>
      <StateSurface state={state}>
        {saved === null ? null : (
          <p role="status" data-testid="assign-success" style={{ margin: 0 }}>
            {t('rooms.saved', { code: saved })}
          </p>
        )}
        {readError === null ? null : <ScreenAlert error={readError} onRetry={() => void load()} />}
        {rooms.length === 0 ? null : (
          <RoomTable
            rooms={rooms}
            roomTypes={roomTypes}
            onAssign={(room) => {
              setSaved(null);
              setAssigning(room);
              setTargetId(room.connectingRoomId ?? '');
            }}
            onUnassign={(room) => void write(room, null)}
          />
        )}
        {assigning === null ? null : (
          <AssignForm
            room={assigning}
            candidates={pairingCandidates(rooms, assigning.id)}
            targetId={targetId}
            onChange={setTargetId}
            onSubmit={(event) => {
              event.preventDefault();
              void write(assigning, targetId === '' ? null : targetId);
            }}
            onCancel={() => {
              setAssigning(null);
              setTargetId('');
            }}
          />
        )}
      </StateSurface>
    </section>
  );
}
