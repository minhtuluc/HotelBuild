'use client';
import { useRef, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { isApiError } from '@pinehill/api-client';
import { color, formatMoney, radius, space, touchTargetPx } from '@pinehill/ui-web';
import type { Payment, WalkInResult } from '@pinehill/contracts';
import type { DeskApi } from './front-desk-api';
import { actionFailure, amountIssue, type ActionFailure } from './front-desk-model';
import { CONTROL, FailureNotice } from './desk-tables';
import {
  pinFailure,
  pinGrantValid,
  pinIssue,
  type PinStep,
} from '../bookings/[bookingId]/collect/collect-model';
import { PinDialog } from '../bookings/[bookingId]/collect/collect-parts';
import { deskText } from './messages';

type Method = 'CASH' | 'BANK_TRANSFER';

/**
 * Bước 4–5 của walk-in: thu cọc cần PIN, gửi `POST /payments` đúng số cọc máy chủ trả. Key idempotency
 * được giữ lại nếu lần trước chưa xác định kết quả — không tạo khoản thu thứ hai khi mạng chập chờn.
 */
export function WalkInDeposit({
  result,
  api,
  pinToken,
  onInspect,
  onDone,
  onPaid,
}: {
  result: WalkInResult;
  api: DeskApi;
  pinToken: { current: string | null };
  onInspect: () => void;
  onDone: () => void;
  onPaid: () => void;
}): ReactElement {
  const [step, setStep] = useState<PinStep>('idle');
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [lockedMinutes, setLockedMinutes] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('CASH');
  const [amount, setAmount] = useState(String(result.booking.depositAmount));
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const payKey = useRef<string | null>(null);
  const amountProblem = amountIssue(amount);
  const verify = async (): Promise<void> => {
    if (pinIssue(pin) !== null) return;
    setBusy(true);
    setUnavailable(false);
    setWrong(false);
    setStep('verifying');
    try {
      const grant = (await api.pinVerify(pin, result.booking.id)).data;
      setPin('');
      if (!pinGrantValid(grant, Date.now())) {
        pinToken.current = null;
        setStep('idle');
        return;
      }
      pinToken.current = grant.pinToken;
      setStep('verified');
    } catch (caught) {
      const problem = pinFailure(caught, isApiError);
      setStep(problem.locked ? 'locked' : 'idle');
      setLockedMinutes(
        problem.retryAfterSeconds === null ? null : Math.ceil(problem.retryAfterSeconds / 60),
      );
      if (problem.locked) return;
      if (
        isApiError(caught) &&
        ['E_AUTH_PIN_REQUIRED', 'E_AUTH_INVALID_CREDENTIALS'].includes(caught.code ?? '')
      )
        setWrong(true);
      else setUnavailable(true);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (): Promise<void> => {
    if (step !== 'verified' || amountProblem !== null) return;
    setBusy(true);
    setFailure(null);
    if (failure?.kind !== 'unknownOutcome') payKey.current = globalThis.crypto.randomUUID();
    try {
      const created = await api.createPayment(
        {
          bookingId: result.booking.id,
          type: 'DEPOSIT',
          method,
          amount: Number.parseInt(amount, 10),
        },
        payKey.current ?? undefined,
      );
      setPayment(created.data);
      onPaid();
      onDone();
    } catch (caught) {
      const mapped = actionFailure(caught);
      setFailure(mapped);
      if (mapped.kind === 'rejected' && mapped.code === 'E_AUTH_PIN_REQUIRED') {
        pinToken.current = null;
        setStep('idle');
      }
    } finally {
      setBusy(false);
    }
  };
  if (payment !== null)
    return (
      <div role="status" data-testid="walk-in-done" style={{ display: 'grid', gap: 8 }}>
        <p style={{ margin: 0 }}>{deskText('depositDone', { code: result.booking.code })}</p>
        <p style={{ margin: 0 }}>
          {deskText('paymentReference', { id: payment.paymentId })} · {formatMoney(payment.amount)}{' '}
          · {payment.method}
        </p>
        <Link
          href={`/bookings/${encodeURIComponent(result.booking.id)}`}
          style={{
            minHeight: touchTargetPx,
            display: 'inline-flex',
            alignItems: 'center',
            color: color.primary,
            textDecoration: 'underline',
          }}
        >
          {deskText('openBooking')}
        </Link>
      </div>
    );
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0 }}>{deskText('depositIntro')}</p>
      <p style={{ margin: 0 }}>
        {deskText('totalAmount', { amount: formatMoney(result.booking.totalAmount) })}
      </p>
      <p style={{ margin: 0 }} data-testid="walk-in-deposit">
        {deskText('depositAmount', { amount: formatMoney(result.booking.depositAmount) })}
      </p>
      <PinDialog
        step={step}
        pin={pin}
        issue={pin === '' ? null : pinIssue(pin)}
        lockedMinutes={lockedMinutes}
        wrong={wrong}
        unavailable={unavailable}
        busy={busy}
        onPin={setPin}
        onSubmit={() => {
          void verify();
        }}
        title={deskText('submitDeposit')}
        description={deskText('depositIntro')}
      />
      <label style={{ display: 'grid', gap: 4 }}>
        {deskText('method')}
        <select
          name="method"
          style={{
            minHeight: touchTargetPx,
            border: `1px solid ${color.borderStrong}`,
            borderRadius: radius.sm,
            padding: space.s2,
          }}
          value={method}
          disabled={busy}
          onChange={(event) => {
            setMethod(event.target.value === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'CASH');
          }}
        >
          <option value="CASH">CASH</option>
          <option value="BANK_TRANSFER">BANK_TRANSFER</option>
        </select>
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        {deskText('amount')}
        <input
          style={CONTROL}
          name="amount"
          inputMode="numeric"
          value={amount}
          disabled={busy}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </label>
      {amountProblem === null ? null : (
        <p role="alert" data-testid="amount-issue" style={{ margin: 0 }}>
          {deskText('invalidAmount')}
        </p>
      )}
      {failure === null ? null : <FailureNotice failure={failure} onInspect={onInspect} />}
      <button
        type="button"
        style={CONTROL}
        disabled={busy || step !== 'verified' || amountProblem !== null}
        onClick={() => {
          void submit();
        }}
      >
        {deskText('submitDeposit')}
      </button>
    </div>
  );
}
