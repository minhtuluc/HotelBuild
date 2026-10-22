/**
 * SCR-58 — chi tiết check-in (UC-FO-01, BR-FO-01). Biểu mẫu chỉ thu `actualRoomIds`, nhận sớm, giấy tờ và
 * ghi chú; **không** tự tính nợ/ngưỡng duyệt nợ/sẵn sàng phòng. Nút xác nhận luôn gửi được khi có mạng và
 * máy chủ là nơi quyết (ADR-018): lý do từ chối hiển thị nguyên văn. Mất mạng thì không gửi, không xếp hàng.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import type { BookingSummary, CheckInResponse, RoomSummary } from '@pinehill/contracts';
import { color, space, touchTargetDp } from '@pinehill/ui-native';
import { statusText } from '../lookup/messages';
import { formatStay, formatVnd } from '../lookup/view';
import { ActionButton, CheckRow } from './controls';
import { formatVnDateTime } from './format';
import { arrivalsText as text } from './messages';
import {
  checkInBody,
  roomChoices,
  roomSelectionIssue,
  suggestRooms,
  type ActionFailure,
  type RoomIssue,
} from './model';
import type { CheckInWriter } from './writer';

export interface CheckInDetailProps {
  booking: BookingSummary;
  rooms: readonly RoomSummary[];
  writer: CheckInWriter;
  /** Sau khi máy chủ xác nhận (hoặc khi cần đối soát): màn danh sách tải lại. */
  onChanged: () => void;
  onClose: () => void;
  /** Chuyển sang thu số dư (SCR-59, HB-154); thiếu thì không hiện nút. */
  onCollectBalance?: (booking: BookingSummary) => void;
  /** Mở SCR-64 ghi no-show (HB-155); thiếu thì không hiện nút. */
  onNoShow?: (booking: BookingSummary) => void;
}

type Result =
  | { kind: 'done'; response: CheckInResponse }
  | { kind: 'offline' }
  | { kind: 'failed'; failure: ActionFailure };

const field = {
  minHeight: touchTargetDp,
  paddingHorizontal: space.s3,
  borderWidth: 1,
  borderRadius: 8,
  color: color.text,
} as const;

function FailureNotice({ failure }: { failure: ActionFailure }): ReactElement {
  switch (failure.kind) {
    case 'rejected':
      return (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ gap: space.s1 }}>
          <Text style={{ color: color.danger, fontWeight: '700' }}>{text('rejected')}</Text>
          <Text>{text('rejectedCode', { code: failure.code })}</Text>
          <Text>{text('rejectedReason', { reason: failure.reason })}</Text>
        </View>
      );
    case 'conflict':
      return (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {text('conflict')}
        </Text>
      );
    case 'forbidden':
      return (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {text('failForbidden')}
        </Text>
      );
    case 'unknownOutcome':
      return (
        <Text accessibilityRole="alert" style={{ color: color.warning }}>
          {text('unknownOutcome', { reference: failure.reference })}
        </Text>
      );
  }
}

function ResultNotice({ result }: { result: Result | null }): ReactElement | null {
  if (result?.kind === 'offline')
    return (
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{ color: color.danger }}
      >
        {text('offlineBlock')}
      </Text>
    );
  return result?.kind === 'failed' ? <FailureNotice failure={result.failure} /> : null;
}

function Facts({
  booking,
  onCollectBalance,
}: {
  booking: BookingSummary;
  onCollectBalance: ((booking: BookingSummary) => void) | undefined;
}): ReactElement {
  const owes = booking.balanceDue > 0;
  return (
    <View style={{ gap: space.s2 }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: 24, fontWeight: '700', color: color.text }}
      >
        {text('checkInTitle', { code: booking.code })}
      </Text>
      <Text>{statusText(booking.status)}</Text>
      <Text>{formatStay(booking.checkIn, booking.checkOut, booking.nights)}</Text>
      <Text>
        {text('totalLine', {
          total: formatVnd(booking.totalAmount),
          paid: formatVnd(booking.paidAmount),
        })}
      </Text>
      <Text testID="check-in-balance" style={{ fontWeight: '700' }}>
        {text('balanceLine', { balance: formatVnd(booking.balanceDue) })}
      </Text>
      {owes ? <Text style={{ color: color.textMuted }}>{text('balanceNote')}</Text> : null}
      {owes && onCollectBalance ? (
        <ActionButton
          testID="check-in-collect"
          label={text('collect')}
          tone="plain"
          onPress={() => {
            onCollectBalance(booking);
          }}
        />
      ) : null}
    </View>
  );
}

function RoomPicker({
  count,
  choices,
  selected,
  busy,
  issue,
  onToggle,
}: {
  count: number;
  choices: readonly RoomSummary[];
  selected: readonly string[];
  busy: boolean;
  issue: RoomIssue | null;
  onToggle: (roomId: string) => void;
}): ReactElement {
  return (
    <View style={{ gap: space.s2 }}>
      <Text style={{ fontWeight: '700' }}>{text('roomsLegend', { count })}</Text>
      <Text style={{ color: color.textMuted }}>{text('roomsHint')}</Text>
      {choices.length === 0 ? <Text>{text('roomsEmpty')}</Text> : null}
      {choices.map((room) => (
        <CheckRow
          key={room.id}
          testID={'check-in-room-' + room.id}
          label={text('roomOption', { code: room.code })}
          checked={selected.includes(room.id)}
          disabled={busy}
          onToggle={() => {
            onToggle(room.id);
          }}
        />
      ))}
      {issue === null ? null : (
        <Text
          accessibilityRole="alert"
          testID="check-in-room-issue"
          style={{ color: color.danger }}
        >
          {text('roomIssue', { count })}
        </Text>
      )}
    </View>
  );
}

function Done({
  booking,
  response,
  rooms,
  onClose,
}: {
  booking: BookingSummary;
  response: CheckInResponse;
  rooms: readonly RoomSummary[];
  onClose: () => void;
}): ReactElement {
  const codes = response.roomIds.map((id) => rooms.find((room) => room.id === id)?.code ?? id);
  return (
    <View style={{ flex: 1, padding: space.s4, gap: space.s3, backgroundColor: color.surface }}>
      <View testID="check-in-done" accessibilityLiveRegion="polite" style={{ gap: space.s2 }}>
        <Text style={{ color: color.success, fontWeight: '700' }}>
          {text('done', { code: booking.code, time: formatVnDateTime(response.checkedInAt) })}
        </Text>
        <Text>{text('roomsAssigned', { rooms: codes.join(', ') })}</Text>
        <Text>{text('earlyFee', { amount: formatVnd(response.earlyCheckInFee) })}</Text>
      </View>
      <ActionButton testID="check-in-close" label={text('closeDetail')} onPress={onClose} />
    </View>
  );
}

function useCheckInForm({
  booking,
  rooms,
  writer,
  onChanged,
}: Pick<CheckInDetailProps, 'booking' | 'rooms' | 'writer' | 'onChanged'>) {
  const choices = roomChoices(rooms, booking);
  const [selected, setSelected] = useState<readonly string[]>(() => suggestRooms(choices, booking));
  const [early, setEarly] = useState(false);
  const [idNumber, setIdNumber] = useState('');
  const [note, setNote] = useState('');
  const [issue, setIssue] = useState<RoomIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const toggle = (roomId: string): void => {
    setSelected((previous) =>
      previous.includes(roomId) ? previous.filter((id) => id !== roomId) : [...previous, roomId],
    );
    setIssue(null);
  };

  const submit = async (): Promise<void> => {
    const problem = roomSelectionIssue(selected, booking, choices);
    setIssue(problem);
    if (problem !== null) return;
    setBusy(true);
    const outcome = await writer.submit(
      checkInBody(booking.id, { roomIds: selected, earlyCheckIn: early, idNumber, note }),
    );
    if (!mounted.current || outcome.kind === 'closed') return;
    setBusy(false);
    setResult(outcome);
    if (outcome.kind === 'done') onChanged();
  };

  return {
    choices,
    selected,
    early,
    idNumber,
    note,
    issue,
    busy,
    result,
    toggle,
    submit,
    setEarly: () => {
      setEarly((value) => !value);
    },
    setIdNumber,
    setNote,
  };
}

export function CheckInDetail(props: CheckInDetailProps): ReactElement {
  const { booking, rooms, onChanged, onClose, onCollectBalance, onNoShow } = props;
  const form = useCheckInForm(props);
  const { result, busy } = form;
  if (result?.kind === 'done')
    return <Done booking={booking} response={result.response} rooms={rooms} onClose={onClose} />;
  const unknown = result?.kind === 'failed' && result.failure.kind === 'unknownOutcome';
  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: space.s4, gap: space.s3 }}>
        <Facts booking={booking} onCollectBalance={onCollectBalance} />
        <RoomPicker
          count={booking.roomCount}
          choices={form.choices}
          selected={form.selected}
          busy={busy}
          issue={form.issue}
          onToggle={form.toggle}
        />
        <CheckRow
          testID="check-in-early"
          label={text('early')}
          checked={form.early}
          disabled={busy}
          onToggle={form.setEarly}
        />
        <Text style={{ color: color.textMuted }}>{text('earlyNote')}</Text>
        <Text>{text('idNumber')}</Text>
        <TextInput
          testID="check-in-id"
          accessibilityLabel={text('idNumber')}
          value={form.idNumber}
          maxLength={50}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={form.setIdNumber}
          style={field}
        />
        <Text>{text('note')}</Text>
        <TextInput
          testID="check-in-note"
          accessibilityLabel={text('note')}
          value={form.note}
          maxLength={500}
          editable={!busy}
          onChangeText={form.setNote}
          style={field}
        />
        <ResultNotice result={result} />
      </ScrollView>
      <View style={{ padding: space.s4, gap: space.s2 }}>
        <ActionButton
          testID="check-in-submit"
          label={busy ? text('submitting') : text('submit')}
          disabled={busy}
          onPress={() => void form.submit()}
        />
        {unknown ? (
          <ActionButton
            testID="check-in-reconcile"
            label={text('reconcile')}
            tone="plain"
            onPress={() => {
              onChanged();
              onClose();
            }}
          />
        ) : null}
        {onNoShow ? (
          <ActionButton
            testID="check-in-no-show"
            label={text('noShow')}
            tone="plain"
            disabled={busy}
            onPress={() => {
              onNoShow(booking);
            }}
          />
        ) : null}
        <ActionButton
          testID="check-in-back"
          label={text('closeDetail')}
          tone="plain"
          onPress={onClose}
        />
      </View>
    </View>
  );
}
