/**
 * SCR-59 — thu số dư tại quầy (UC-PAY-03). Số tiền gợi ý và giới hạn là `balanceDue` do máy chủ trả
 * (`GET /bookings/{id}/balance`); màn hình chỉ gửi đúng con số người dùng xác nhận, máy chủ kiểm lại
 * (BR-PAY-01/02). Lệnh 🔒 PIN, chỉ khi có mạng; không có ô dữ liệu thẻ (BR-PAY-04); không in biên lai.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import type { BookingSummary, Payment } from '@pinehill/contracts';
import { color, space, touchTargetDp } from '@pinehill/ui-native';
import { ActionButton } from '../arrivals/controls';
import { formatVnd } from '../lookup/view';
import type { Session } from '../session';
import { ChoiceRow, PinPanel, ResultNotice, type Outcome } from './controls';
import { useBalance, useStayWriter } from './hooks';
import { stayText as text } from './messages';
import {
  COUNTER_METHODS,
  amountIssue,
  collectBody,
  type AmountIssue,
  type CollectBody,
  type CounterMethod,
} from './model';
import { balancePorts } from './ports';
import type { BalanceState } from './reader';
import type { PinnedWriter } from './writer';

export interface CollectScreenProps {
  session: Session;
  booking: BookingSummary;
  createWriter: () => PinnedWriter<CollectBody, Payment>;
  onClose: () => void;
}

const AMOUNT_KEY: Readonly<Record<AmountIssue, 'amountFormat' | 'amountPositive' | 'amountOver'>> =
  {
    FORMAT: 'amountFormat',
    POSITIVE: 'amountPositive',
    OVER: 'amountOver',
  };

function balanceMessage(state: BalanceState): string | null {
  switch (state.phase) {
    case 'idle':
    case 'loading':
      return text('balanceLoading');
    case 'offline':
      return text('balanceOffline');
    case 'expired':
      return text('balanceExpired');
    case 'forbidden':
      return text('balanceForbidden');
    case 'error':
      return text('balanceError');
    case 'ready':
      return null;
  }
}

function Done({
  payment,
  balance,
  onClose,
}: {
  payment: Payment;
  balance: BalanceState;
  onClose: () => void;
}): ReactElement {
  return (
    <View style={{ flex: 1, padding: space.s4, gap: space.s3, backgroundColor: color.surface }}>
      <View testID="collect-done" accessibilityLiveRegion="polite" style={{ gap: space.s2 }}>
        <Text style={{ color: color.success, fontWeight: '700' }}>
          {text('collectDone', {
            amount: formatVnd(payment.amount),
            method: text(payment.method === 'CASH' ? 'method_CASH' : 'method_BANK_TRANSFER'),
            status: text(`status_${payment.status}`),
          })}
        </Text>
        <Text>{text('paymentRef', { id: payment.paymentId })}</Text>
        {balance.balance === null ? null : (
          <Text testID="collect-due-after">
            {text('dueAfter', { balance: formatVnd(balance.balance.balanceDue) })}
          </Text>
        )}
      </View>
      <ActionButton testID="collect-close" label={text('closeDetail')} onPress={onClose} />
    </View>
  );
}

function useCollectForm(
  booking: BookingSummary,
  writer: PinnedWriter<CollectBody, Payment> | null,
  due: number | null,
  reloadBalance: () => void,
) {
  const [method, setMethod] = useState<CounterMethod>('CASH');
  const [edited, setEdited] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [issue, setIssue] = useState<AmountIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Outcome<Payment> | null>(null);
  const amount = edited ?? (due === null ? '' : String(due));
  const submit = async (): Promise<void> => {
    if (writer === null || due === null) return;
    const problem = amountIssue(amount, due);
    setIssue(problem);
    if (problem !== null) return;
    setBusy(true);
    const outcome = await writer.submit(collectBody(booking.id, { method, amount, note }));
    if (outcome.kind === 'closed') return;
    setBusy(false);
    setResult(outcome);
    setUnlocked(writer.unlocked);
    if (outcome.kind === 'done') reloadBalance();
  };
  return {
    method,
    setMethod,
    amount,
    setEdited,
    note,
    setNote,
    unlocked,
    setUnlocked,
    issue,
    busy,
    result,
    submit,
  };
}

const FIELD = {
  minHeight: touchTargetDp,
  paddingHorizontal: space.s3,
  borderWidth: 1,
  borderRadius: 8,
  color: color.text,
} as const;

function DueBlock({ state, penalty }: { state: BalanceState; penalty: number }): ReactElement {
  const pending = balanceMessage(state);
  const due = state.balance?.balanceDue ?? 0;
  return (
    <>
      {pending === null ? (
        <Text testID="collect-due" style={{ fontWeight: '700' }}>
          {text('dueNow', { balance: formatVnd(due) })}
        </Text>
      ) : (
        <Text testID="collect-balance-state" accessibilityLiveRegion="polite">
          {pending}
        </Text>
      )}
      {penalty > 0 ? <Text>{text('penaltyLine', { penalty: formatVnd(penalty) })}</Text> : null}
      {pending === null && due === 0 ? <Text>{text('noDue')}</Text> : null}
    </>
  );
}

function MethodPicker({
  method,
  disabled,
  onSelect,
}: {
  method: CounterMethod;
  disabled: boolean;
  onSelect: (method: CounterMethod) => void;
}): ReactElement {
  return (
    <>
      <Text style={{ fontWeight: '700' }}>{text('method')}</Text>
      {COUNTER_METHODS.map((option) => (
        <ChoiceRow
          key={option}
          testID={'collect-method-' + option}
          label={text(option === 'CASH' ? 'method_CASH' : 'method_BANK_TRANSFER')}
          selected={method === option}
          disabled={disabled}
          onSelect={() => {
            onSelect(option);
          }}
        />
      ))}
    </>
  );
}

function Footer({
  busy,
  ready,
  showReload,
  onSubmit,
  onReload,
  onClose,
}: {
  busy: boolean;
  ready: boolean;
  showReload: boolean;
  onSubmit: () => void;
  onReload: () => void;
  onClose: () => void;
}): ReactElement {
  return (
    <View style={{ padding: space.s4, gap: space.s2 }}>
      <ActionButton
        testID="collect-submit"
        label={busy ? text('submitting') : text('submitCollect')}
        disabled={busy || !ready}
        onPress={onSubmit}
      />
      {showReload ? (
        <ActionButton
          testID="collect-reload"
          label={text('balanceRetry')}
          tone="plain"
          onPress={onReload}
        />
      ) : null}
      <ActionButton
        testID="collect-back"
        label={text('closeDetail')}
        tone="plain"
        onPress={onClose}
      />
    </View>
  );
}

export function CollectScreen({
  session,
  booking,
  createWriter,
  onClose,
}: CollectScreenProps): ReactElement {
  const ports = useMemo(() => balancePorts(session), [session]);
  const writer = useStayWriter(session, createWriter);
  const balance = useBalance(ports, booking.id);
  const due = balance.state.balance?.balanceDue ?? null;
  const reload = (): void => {
    balance.load(booking.id);
  };
  const form = useCollectForm(booking, writer, due, reload);
  const { result } = form;
  if (result?.kind === 'done')
    return <Done payment={result.response} balance={balance.state} onClose={onClose} />;
  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: space.s4, gap: space.s3 }}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 24, fontWeight: '700', color: color.text }}
        >
          {text('collectTitle', { code: booking.code })}
        </Text>
        <DueBlock state={balance.state} penalty={booking.penaltyAmount} />
        <MethodPicker method={form.method} disabled={form.busy} onSelect={form.setMethod} />
        <Text>{text('amount')}</Text>
        <TextInput
          testID="collect-amount"
          accessibilityLabel={text('amount')}
          value={form.amount}
          keyboardType="number-pad"
          editable={!form.busy}
          onChangeText={form.setEdited}
          style={FIELD}
        />
        {form.issue === null ? null : (
          <Text
            testID="collect-amount-issue"
            accessibilityRole="alert"
            style={{ color: color.danger }}
          >
            {text(AMOUNT_KEY[form.issue])}
          </Text>
        )}
        <Text>{text('note')}</Text>
        <TextInput
          testID="collect-note"
          accessibilityLabel={text('note')}
          value={form.note}
          maxLength={500}
          editable={!form.busy}
          onChangeText={form.setNote}
          style={FIELD}
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
      </ScrollView>
      <Footer
        busy={form.busy}
        ready={form.unlocked && due !== null}
        showReload={balance.state.phase !== 'ready' && balance.state.phase !== 'loading'}
        onSubmit={() => void form.submit()}
        onReload={reload}
        onClose={onClose}
      />
    </View>
  );
}
