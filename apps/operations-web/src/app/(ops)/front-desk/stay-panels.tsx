'use client';
import { useState, type ReactElement } from 'react';
import { isApiError } from '@pinehill/api-client';
import { formatDateTimeVn, formatMoney } from '@pinehill/ui-web';
import type { BookingSummary, CheckOutResponse, NoShowResponse } from '@pinehill/contracts';
import type { DeskApi } from './front-desk-api';
import { actionFailure, checkOutBody, type ActionFailure } from './front-desk-model';
import { CONTROL, FailureNotice } from './desk-tables';
import {
  pinFailure,
  pinGrantValid,
  pinIssue,
  type PinStep,
} from '../bookings/[bookingId]/collect/collect-model';
import { PinDialog } from '../bookings/[bookingId]/collect/collect-parts';
import { deskText } from './messages';

/**
 * Trả phòng: PIN bắt buộc trước lệnh tài chính; phụ thu trả muộn/sớm chỉ hiện **sau** khi máy chủ xác
 * nhận vì hợp đồng chưa có nguồn số tiền trước đó (BLOCKED, xem PR) — trước xác nhận chỉ nêu hệ quả.
 */
export function CheckOutPanel({
  booking,
  api,
  pinToken,
  onDone,
  onInspect,
}: {
  booking: BookingSummary;
  api: DeskApi;
  pinToken: { current: string | null };
  onDone: () => void;
  onInspect: () => void;
}): ReactElement {
  const [step, setStep] = useState<PinStep>('idle');
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [lockedMinutes, setLockedMinutes] = useState<number | null>(null);
  const [early, setEarly] = useState(false);
  const [late, setLate] = useState(false);
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<CheckOutResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const verify = async (): Promise<void> => {
    if (pinIssue(pin) !== null) return;
    setBusy(true);
    setUnavailable(false);
    setWrong(false);
    setStep('verifying');
    try {
      const grant = (await api.pinVerify(pin, booking.id)).data;
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
    if (step !== 'verified') return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await api.checkOut(
        checkOutBody(booking.id, { earlyCheckOut: early, lateCheckOut: late, note }),
      );
      setResult(response.data);
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
  if (result !== null)
    return (
      <div role="status" data-testid="check-out-done" style={{ display: 'grid', gap: 4 }}>
        <p style={{ margin: 0 }}>
          {deskText('checkoutDone', {
            code: booking.code,
            time: formatDateTimeVn(result.checkedOutAt),
          })}
        </p>
        <p style={{ margin: 0 }}>{deskText('fee', { amount: formatMoney(result.feeAmount) })}</p>
        <p style={{ margin: 0 }}>
          {deskText('extras', { amount: formatMoney(result.extrasAmount) })}
        </p>
        <p style={{ margin: 0 }}>
          {deskText('balanceAfter', { amount: formatMoney(result.balanceDue) })}
        </p>
        <p style={{ margin: 0 }}>
          {deskText('tasks', { count: result.housekeepingTaskIds.length })}
        </p>
      </div>
    );
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0 }} data-testid="checkout-policy">
        {deskText('checkoutNote')}
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
        title={deskText('checkOutTitle', { code: booking.code })}
        description={deskText('pinRequired')}
      />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          name="earlyCheckOut"
          checked={early}
          disabled={busy}
          onChange={(event) => {
            setEarly(event.target.checked);
          }}
        />
        {deskText('earlyCheckout')}
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          name="lateCheckOut"
          checked={late}
          disabled={busy}
          onChange={(event) => {
            setLate(event.target.checked);
          }}
        />
        {deskText('lateCheckout')}
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
      <button
        type="button"
        style={CONTROL}
        disabled={busy || step !== 'verified'}
        onClick={() => {
          void submit();
        }}
      >
        {deskText('submitCheckout')}
      </button>
    </div>
  );
}

/** Ghi no-show: hiện hệ quả chính sách trước xác nhận; số tiền chỉ lấy từ phản hồi máy chủ (AC2). */
export function NoShowPanel({
  booking,
  api,
  onDone,
  onInspect,
}: {
  booking: BookingSummary;
  api: DeskApi;
  onDone: () => void;
  onInspect: () => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<NoShowResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (reason.trim() === '') return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await api.noShow({ bookingId: booking.id, reason: reason.trim() });
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
      <div role="status" data-testid="no-show-done" style={{ display: 'grid', gap: 4 }}>
        <p style={{ margin: 0 }}>
          {deskText('noShowDone', { code: booking.code, time: formatDateTimeVn(result.markedAt) })}
        </p>
        <p style={{ margin: 0 }}>
          {deskText('penalty', { amount: formatMoney(result.penaltyAmount) })}
        </p>
        <p style={{ margin: 0 }}>
          {deskText('refundRequest', { value: result.refundRequestId ?? '—' })}
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
      <p style={{ margin: 0 }} data-testid="no-show-policy">
        {deskText('noShowPolicy')}
      </p>
      <label style={{ display: 'grid', gap: 4 }}>
        {deskText('reason')}
        <input
          style={CONTROL}
          name="reason"
          required
          maxLength={500}
          value={reason}
          disabled={busy}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </label>
      {failure === null ? null : <FailureNotice failure={failure} onInspect={onInspect} />}
      <button type="submit" style={CONTROL} disabled={busy || reason.trim() === ''}>
        {deskText('submitNoShow')}
      </button>
    </form>
  );
}
