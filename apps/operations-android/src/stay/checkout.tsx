/**
 * SCR-61 — trả phòng / trả muộn (UC-FO-02; BR-FO-03/05/06). Lệnh 🔒 PIN, chỉ khi có mạng. Phụ thu muộn do
 * máy chủ quyết theo giờ nghiệp vụ nên **không có số trước khi xác nhận**; màn hình hiển thị số máy chủ trả
 * sau khi hoàn tất, hoặc — khi còn số dư nên máy chủ từ chối `E_PAY_AMOUNT_MISMATCH` sau khi ghi nghĩa vụ —
 * số `balanceDue` đọc lại từ máy chủ rồi chuyển sang thu số dư (SCR-59).
 */
import { useMemo, useState, type ReactElement } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import type { BookingSummary, CheckOutResponse } from '@pinehill/contracts';
import { color, space, touchTargetDp } from '@pinehill/ui-native';
import { ActionButton, CheckRow } from '../arrivals/controls';
import { formatVnDateTime } from '../arrivals/format';
import { formatStay, formatVnd } from '../lookup/view';
import type { Session } from '../session';
import { PinPanel, ResultNotice, type Outcome } from './controls';
import { useBalance, useStayWriter } from './hooks';
import { stayText as text } from './messages';
import { checkOutBody, isEarlyCheckOut, isUnsettled, type CheckOutBody } from './model';
import { balancePorts } from './ports';
import type { BalanceState } from './reader';
import type { PinnedWriter } from './writer';

export interface CheckOutDetailProps {
  session: Session;
  booking: BookingSummary;
  /** Ngày nghiệp vụ VN của danh sách, chỉ để khởi tạo cờ "trả sớm". */
  date: string;
  createWriter: () => PinnedWriter<CheckOutBody, CheckOutResponse>;
  onChanged: () => void;
  onClose: () => void;
  onCollectBalance: (booking: BookingSummary) => void;
}

function Done({
  booking,
  response,
  onClose,
}: {
  booking: BookingSummary;
  response: CheckOutResponse;
  onClose: () => void;
}): ReactElement {
  return (
    <View style={{ flex: 1, padding: space.s4, gap: space.s3, backgroundColor: color.surface }}>
      <View testID="check-out-done" accessibilityLiveRegion="polite" style={{ gap: space.s2 }}>
        <Text style={{ color: color.success, fontWeight: '700' }}>
          {text('checkOutDone', {
            code: booking.code,
            time: formatVnDateTime(response.checkedOutAt),
          })}
        </Text>
        <Text testID="check-out-fee">
          {text('feeLine', { amount: formatVnd(response.feeAmount) })}
        </Text>
        <Text>{text('extrasLine', { amount: formatVnd(response.extrasAmount) })}</Text>
        <Text>{text('balanceAfter', { amount: formatVnd(response.balanceDue) })}</Text>
        <Text>{text('tasksLine', { count: response.housekeepingTaskIds.length })}</Text>
      </View>
      <ActionButton testID="check-out-close" label={text('closeDetail')} onPress={onClose} />
    </View>
  );
}

function useCheckOutForm(
  props: Pick<CheckOutDetailProps, 'booking' | 'date' | 'onChanged'>,
  writer: PinnedWriter<CheckOutBody, CheckOutResponse> | null,
  loadBalance: (bookingId: string) => void,
) {
  const { booking, date, onChanged } = props;
  const [early, setEarly] = useState(() => isEarlyCheckOut(booking, date));
  const [note, setNote] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Outcome<CheckOutResponse> | null>(null);
  const submit = async (): Promise<void> => {
    if (writer === null) return;
    setBusy(true);
    const outcome = await writer.submit(checkOutBody(booking.id, { early, note }));
    if (outcome.kind === 'closed') return;
    setBusy(false);
    setResult(outcome);
    setUnlocked(writer.unlocked);
    if (outcome.kind === 'done') onChanged();
    if (outcome.kind === 'failed' && isUnsettled(outcome.failure)) loadBalance(booking.id);
  };
  return { early, setEarly, note, setNote, unlocked, setUnlocked, busy, result, submit };
}

function Unsettled({ balance }: { balance: BalanceState }): ReactElement {
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: space.s2 }}>
      <Text testID="check-out-unsettled">{text('unsettled')}</Text>
      {balance.balance === null ? null : (
        <Text testID="check-out-unsettled-balance" style={{ fontWeight: '700' }}>
          {text('unsettledBalance', { balance: formatVnd(balance.balance.balanceDue) })}
        </Text>
      )}
    </View>
  );
}

function Footer({
  busy,
  unlocked,
  flags,
  onSubmit,
  onCollect,
  onReconcile,
  onClose,
}: {
  busy: boolean;
  unlocked: boolean;
  flags: Flags;
  onSubmit: () => void;
  onCollect: () => void;
  onReconcile: () => void;
  onClose: () => void;
}): ReactElement {
  return (
    <View style={{ padding: space.s4, gap: space.s2 }}>
      <ActionButton
        testID="check-out-submit"
        label={busy ? text('submitting') : text('submitCheckOut')}
        disabled={busy || !unlocked}
        onPress={onSubmit}
      />
      {flags.unsettled ? (
        <ActionButton
          testID="check-out-collect"
          label={text('collect')}
          tone="plain"
          onPress={onCollect}
        />
      ) : null}
      {flags.unknown ? (
        <ActionButton
          testID="check-out-reconcile"
          label={text('reconcile')}
          tone="plain"
          onPress={onReconcile}
        />
      ) : null}
      <ActionButton
        testID="check-out-back"
        label={text('closeDetail')}
        tone="plain"
        onPress={onClose}
      />
    </View>
  );
}

interface Flags {
  unsettled: boolean;
  unknown: boolean;
}

function flagsOf(result: Outcome<CheckOutResponse> | null): Flags {
  if (result?.kind !== 'failed') return { unsettled: false, unknown: false };
  return {
    unsettled: isUnsettled(result.failure),
    unknown: result.failure.kind === 'unknownOutcome',
  };
}

export function CheckOutDetail(props: CheckOutDetailProps): ReactElement {
  const { session, booking, createWriter, onChanged, onClose, onCollectBalance } = props;
  const ports = useMemo(() => balancePorts(session), [session]);
  const writer = useStayWriter(session, createWriter);
  const balance = useBalance(ports);
  const form = useCheckOutForm(props, writer, balance.load);
  const { result, busy } = form;
  if (result?.kind === 'done')
    return <Done booking={booking} response={result.response} onClose={onClose} />;
  const flags = flagsOf(result);
  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: space.s4, gap: space.s3 }}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 24, fontWeight: '700', color: color.text }}
        >
          {text('checkOutTitle', { code: booking.code })}
        </Text>
        <Text>
          {text('stayLine', {
            stay: formatStay(booking.checkIn, booking.checkOut, booking.nights),
          })}
        </Text>
        <Text testID="check-out-balance" style={{ fontWeight: '700' }}>
          {text('balanceLine', { balance: formatVnd(booking.balanceDue) })}
        </Text>
        <Text style={{ color: color.textMuted }}>{text('checkOutNote')}</Text>
        <CheckRow
          testID="check-out-early"
          label={text('early')}
          checked={form.early}
          disabled={busy}
          onToggle={() => {
            form.setEarly((value) => !value);
          }}
        />
        <Text style={{ color: color.textMuted }}>{text('earlyNote')}</Text>
        <Text>{text('note')}</Text>
        <TextInput
          testID="check-out-note"
          accessibilityLabel={text('note')}
          value={form.note}
          maxLength={500}
          editable={!busy}
          onChangeText={form.setNote}
          style={{
            minHeight: touchTargetDp,
            paddingHorizontal: space.s3,
            borderWidth: 1,
            borderRadius: 8,
            color: color.text,
          }}
        />
        <PinPanel
          bookingId={booking.id}
          writer={writer}
          unlocked={form.unlocked}
          onUnlocked={() => {
            form.setUnlocked(true);
          }}
        />
        <ResultNotice result={result} />
        {flags.unsettled ? <Unsettled balance={balance.state} /> : null}
      </ScrollView>
      <Footer
        busy={busy}
        unlocked={form.unlocked}
        flags={flags}
        onSubmit={() => void form.submit()}
        onCollect={() => {
          onCollectBalance(booking);
        }}
        onReconcile={() => {
          onChanged();
          onClose();
        }}
        onClose={onClose}
      />
    </View>
  );
}
