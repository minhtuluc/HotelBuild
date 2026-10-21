'use client';
import { useState, type ReactElement } from 'react';
import { formatDateTimeVn, formatMoney } from '@pinehill/ui-web';
import type { BookingSummary, CheckInResponse, RoomSummary } from '@pinehill/contracts';
import type { DeskApi } from './front-desk-api';
import {
  actionFailure,
  checkInBody,
  roomChoices,
  roomSelectionIssue,
  type ActionFailure,
  type RoomIssue,
} from './front-desk-model';
import { CONTROL, FailureNotice } from './desk-tables';
import { deskText } from './messages';

/**
 * Nhận phòng: nút gửi luôn bật và **không** tự tính nợ/sẵn sàng. Máy chủ từ chối thì hiện mã + lý do
 * (AC1); chọn phòng chỉ là kiểm biểu mẫu theo `actualRoomIds` của hợp đồng.
 */
export function CheckInPanel({
  booking,
  rooms,
  api,
  onDone,
  onInspect,
}: {
  booking: BookingSummary;
  rooms: readonly RoomSummary[];
  api: DeskApi;
  onDone: () => void;
  onInspect: () => void;
}): ReactElement {
  const choices = roomChoices(rooms, booking);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [early, setEarly] = useState(false);
  const [idNumber, setIdNumber] = useState('');
  const [note, setNote] = useState('');
  const [issue, setIssue] = useState<RoomIssue | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<CheckInResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (roomId: string, checked: boolean): void => {
    setSelected((previous) =>
      checked
        ? [...previous.filter((id) => id !== roomId), roomId]
        : previous.filter((id) => id !== roomId),
    );
    setIssue(null);
  };
  const submit = async (): Promise<void> => {
    const problem = roomSelectionIssue(selected, booking, choices);
    setIssue(problem);
    if (problem !== null) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await api.checkIn(
        checkInBody(booking.id, { roomIds: selected, earlyCheckIn: early, idNumber, note }),
      );
      setResult(response.data);
      onDone();
    } catch (caught) {
      setFailure(actionFailure(caught));
    } finally {
      setBusy(false);
    }
  };
  if (result !== null)
    return (
      <div role="status" data-testid="check-in-done" style={{ display: 'grid', gap: 4 }}>
        <p style={{ margin: 0 }}>
          {deskText('checkInDone', {
            code: booking.code,
            time: formatDateTimeVn(result.checkedInAt),
          })}
        </p>
        <p style={{ margin: 0 }}>
          {deskText('roomAssigned', { rooms: result.roomIds.join(', ') })}
        </p>
        <p style={{ margin: 0 }}>
          {deskText('checkInFee', { amount: formatMoney(result.earlyCheckInFee) })}
        </p>
      </div>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      style={{ display: 'grid', gap: 12 }}
    >
      <fieldset style={{ display: 'grid', gap: 4, border: 0, padding: 0, margin: 0 }}>
        <legend style={{ padding: 0, marginBottom: 4 }}>
          {deskText('roomLabel', { count: booking.roomCount })}
        </legend>
        {choices.length === 0 ? <p style={{ margin: 0 }}>{deskText('roomEmpty')}</p> : null}
        {choices.map((room) => (
          <label key={room.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              name="actualRoomIds"
              value={room.id}
              checked={selected.includes(room.id)}
              disabled={busy}
              onChange={(event) => {
                toggle(room.id, event.target.checked);
              }}
            />
            {room.code}
          </label>
        ))}
      </fieldset>
      {issue === null ? null : (
        <p role="alert" data-testid="room-issue" style={{ margin: 0 }}>
          {deskText('roomIssue', { count: booking.roomCount })}
        </p>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          name="earlyCheckIn"
          checked={early}
          disabled={busy}
          onChange={(event) => {
            setEarly(event.target.checked);
          }}
        />
        {deskText('earlyCheckIn')}
      </label>
      <p style={{ margin: 0 }}>{deskText('earlyNote')}</p>
      <label style={{ display: 'grid', gap: 4 }}>
        {deskText('idNumber')}
        <input
          style={CONTROL}
          name="idNumber"
          maxLength={50}
          value={idNumber}
          disabled={busy}
          onChange={(event) => {
            setIdNumber(event.target.value);
          }}
        />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {deskText('note')}
        <input
          style={CONTROL}
          name="note"
          maxLength={500}
          value={note}
          disabled={busy}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </label>
      {failure === null ? null : <FailureNotice failure={failure} onInspect={onInspect} />}
      <button type="submit" style={CONTROL} disabled={busy || choices.length === 0}>
        {deskText('submitCheckIn')}
      </button>
    </form>
  );
}
