'use client';
import { useState, type ReactElement } from 'react';
import { color, formatDateTimeVn, formatMoney, radius, space } from '@pinehill/ui-web';
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
import { FailureNotice } from './desk-tables';
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
      <div
        role="status"
        data-testid="check-in-done"
        style={{
          display: 'grid',
          gap: 6,
          padding: `${space.s3}px ${space.s4}px`,
          background: '#E7F3EE',
          border: `1px solid ${color.border}`,
          boxShadow: `inset 0 0 0 1px ${color.success}`,
          borderRadius: radius.sm,
        }}
      >
        <p style={{ margin: 0, color: color.success, fontWeight: 500 }}>
          {deskText('checkInDone', {
            code: booking.code,
            time: formatDateTimeVn(result.checkedInAt),
          })}
        </p>
        <p style={{ margin: 0 }}>
          {deskText('roomAssigned', { rooms: result.roomIds.join(', ') })}
        </p>
        <p style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>
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
      style={{ display: 'grid', gap: space.s3, maxWidth: 560 }}
    >
      <fieldset style={{ display: 'grid', gap: 6, border: 0, padding: 0, margin: 0 }}>
        <legend style={{ padding: 0, marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
          {deskText('roomLabel', { count: booking.roomCount })}
        </legend>
        {choices.length === 0 ? <p style={{ margin: 0 }}>{deskText('roomEmpty')}</p> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.s2 }}>
          {choices.map((room) => (
            <label
              key={room.id}
              style={{
                display: 'inline-flex',
                gap: 8,
                alignItems: 'center',
                minHeight: 44,
                padding: `0 ${space.s3}px`,
                border: `1px solid ${selected.includes(room.id) ? color.primary : color.border}`,
                borderRadius: radius.sm,
                background: selected.includes(room.id) ? '#E7F3EE' : color.bg,
                cursor: 'pointer',
              }}
            >
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
              <span>{room.code}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {issue === null ? null : (
        <p
          role="alert"
          data-testid="room-issue"
          style={{ margin: 0, color: color.danger, fontSize: 13 }}
        >
          {deskText('roomIssue', { count: booking.roomCount })}
        </p>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
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
      <p style={{ margin: 0, fontSize: 13, color: color.textMuted }}>{deskText('earlyNote')}</p>
      <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
        {deskText('idNumber')}
        <input
          name="idNumber"
          maxLength={50}
          value={idNumber}
          disabled={busy}
          onChange={(event) => {
            setIdNumber(event.target.value);
          }}
        />
      </label>
      <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 }}>
        {deskText('note')}
        <input
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
      <button
        type="submit"
        className="ph-btn-primary"
        style={{ justifySelf: 'start' }}
        disabled={busy || choices.length === 0}
      >
        {deskText('submitCheckIn')}
      </button>
    </form>
  );
}
