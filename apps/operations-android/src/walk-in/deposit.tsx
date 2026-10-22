import { useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { color, space } from '@pinehill/ui-native';
import { formatVnd } from '../lookup/view';
import { ActionButton, Choice, Field } from './controls';
import type { WalkInFlow, WalkInState } from './flow';
import { walkInText as text } from './messages';
import type { DepositMethod } from './model';
import { Problem } from './steps';

const METHODS: readonly DepositMethod[] = ['CASH', 'BANK_TRANSFER'];

function pinMessage(state: WalkInState): string | null {
  switch (state.pin) {
    case 'verified':
      return text('pinVerified');
    case 'wrong':
      return text('pinWrong');
    case 'locked':
      return state.lockedMinutes === null
        ? text('pinLockedUnknown')
        : text('pinLocked', { minutes: state.lockedMinutes });
    case 'unavailable':
      return text('pinUnavailable');
    case 'idle':
      return null;
  }
}

function MethodPicker({
  method,
  busy,
  onChange,
}: {
  method: DepositMethod;
  busy: boolean;
  onChange: (method: DepositMethod) => void;
}): ReactElement {
  return (
    <>
      <Text style={{ fontWeight: '700' }}>{text('method')}</Text>
      {METHODS.map((item) => (
        <Choice
          key={item}
          testID={'walk-in-method-' + item}
          label={text(item === 'CASH' ? 'methodCASH' : 'methodBANK_TRANSFER')}
          selected={method === item}
          disabled={busy}
          onSelect={() => {
            onChange(item);
          }}
        />
      ))}
    </>
  );
}

function PinEntry({ flow, state }: { flow: WalkInFlow; state: WalkInState }): ReactElement {
  const [pin, setPin] = useState('');
  const busy = state.busy !== null;
  const locked = state.pin === 'locked';
  return (
    <>
      <Field
        testID="walk-in-pin"
        label={text('pin')}
        value={pin}
        secure
        keyboard="number-pad"
        maxLength={6}
        editable={!busy && !locked}
        onChange={setPin}
      />
      <ActionButton
        testID="walk-in-verify-pin"
        label={state.busy === 'verifying' ? text('verifying') : text('verifyPin')}
        disabled={busy || locked || !/^\d{6}$/.test(pin)}
        onPress={() => {
          const entered = pin;
          setPin('');
          void flow.verifyPin(entered);
        }}
      />
    </>
  );
}

function Collect({
  flow,
  state,
  method,
}: {
  flow: WalkInFlow;
  state: WalkInState;
  method: DepositMethod;
}): ReactElement {
  const verified = state.pin === 'verified';
  return (
    <>
      {verified ? null : <PinEntry flow={flow} state={state} />}
      <Text testID="walk-in-pin-state" accessibilityLiveRegion="polite">
        {pinMessage(state)}
      </Text>
      <ActionButton
        testID="walk-in-pay"
        label={state.busy === 'paying' ? text('paying') : text('pay')}
        disabled={state.busy !== null || !verified}
        onPress={() => void flow.pay(method)}
      />
    </>
  );
}

/** Bước 4: số cọc là số máy chủ trả; PIN 6 số → `pinToken` dùng một lần → `POST /payments`. */
export function DepositStep({
  flow,
  state,
}: {
  flow: WalkInFlow;
  state: WalkInState;
}): ReactElement | null {
  const [method, setMethod] = useState<DepositMethod>('CASH');
  const booking = state.result?.booking;
  if (booking === undefined) return null;
  const due = booking.depositAmount > 0;
  return (
    <View style={{ gap: space.s2 }} testID="walk-in-deposit">
      <Text style={{ color: color.success, fontWeight: '700' }}>
        {text('created', { code: booking.code })}
      </Text>
      {state.result?.created === false ? (
        <Problem id="walk-in-duplicate" message={text('duplicate')} />
      ) : null}
      <Text>{text('totalAmount', { amount: formatVnd(booking.totalAmount) })}</Text>
      <Text testID="walk-in-deposit-amount">
        {due
          ? text('depositAmount', { amount: formatVnd(booking.depositAmount) })
          : text('noDeposit')}
      </Text>
      {due ? (
        <MethodPicker method={method} busy={state.busy !== null} onChange={setMethod} />
      ) : null}
      {due ? <Collect flow={flow} state={state} method={method} /> : null}
      <ActionButton
        testID="walk-in-skip-deposit"
        label={text('skipDeposit')}
        tone="plain"
        disabled={state.busy !== null}
        onPress={() => {
          flow.skipDeposit();
        }}
      />
    </View>
  );
}
