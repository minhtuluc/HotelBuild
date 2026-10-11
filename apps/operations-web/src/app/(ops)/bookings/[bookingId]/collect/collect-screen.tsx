'use client';

/**
 * SCR-37 (HB-109) — thu cọc / thu số dư tại quầy cho back-office.
 *
 * **AC1**: nhập PIN qua hộp thoại (`POST /auth/pin/verify` với pin+bookingId), token chỉ nằm trong bộ nhớ
 * của phiên thao tác (không log/lưu); PIN sai cho nhập lại, PIN bị khoá thì **dừng phiên** và không gọi
 * lệnh tài chính; sau đó `POST /payments` (client tự chèn `pinToken`). Biên lai in được, không có ô dữ liệu
 * thẻ (BR-PAY-04). Số tiền do máy chủ quyết — màn hình chỉ gợi ý mức còn ghi nhận.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ApiClient,
  createAuthApi,
  createBookingApi,
  createPaymentApi,
  isApiError,
} from '@pinehill/api-client';
import type { BookingBalance, BookingSummary, Payment, PinToken } from '@pinehill/contracts';
import { StateSurface, formatMoney, type ScreenState } from '@pinehill/ui-web';
import { createSessionClient } from '@pinehill/web-session/client';
import { ScreenAlert } from '../../../../../components/screen-alert';
import { useForcedState } from '../../../../../components/forced-state';
import { t } from '../../../../../lib/i18n';
import { readFailureState, writeFailureState } from '../../../../../lib/screen-state';
import { CollectBody } from './collect-body';
import {
  amountIssue,
  canSendPayment,
  pinFailure,
  pinGrantValid,
  pinIssue,
  suggestedAmount,
  type CollectMethod,
  type CollectType,
  type PinStep,
} from './collect-model';

export function CollectScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const params = useParams<{ bookingId: string }>();
  const bookingId = typeof params.bookingId === 'string' ? params.bookingId : '';
  const pinToken = useRef<string | null>(null);
  const grant = useRef<PinToken | null>(null);
  const sending = useRef(false);
  const verifying = useRef(false);
  const epoch = useRef(0);
  const active = useRef(true);
  const denied = useRef(false);
  const reading = useRef(0);
  const session = useRef<ReturnType<typeof createSessionClient> | null>(null);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [balance, setBalance] = useState<BookingBalance | null>(null);
  const [step, setStep] = useState<PinStep>('idle');
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [lockedMinutes, setLockedMinutes] = useState<number | null>(null);
  const [type, setType] = useState<CollectType>('DEPOSIT');
  const [method, setMethod] = useState<CollectMethod>('CASH');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const due = booking === null || balance === null ? 0 : suggestedAmount(booking, balance, type);
  const amountIssueValue = amountIssue(amount, due);
  const clearGrant = useCallback(() => {
    grant.current = null;
    pinToken.current = null;
    setExpiresAt(null);
    setPin('');
    setStep('idle');
  }, []);
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = window.setTimeout(clearGrant, Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [clearGrant, expiresAt]);
  const denyView = useCallback(() => {
    epoch.current += 1;
    denied.current = true;
    clearGrant();
    setBooking(null);
    setBalance(null);
    setAmount('');
    setNote('');
    setWrong(false);
    setUnavailable(false);
    setError(null);
    setBusy(false);
    setState({ kind: 'forbidden' });
  }, [clearGrant]);
  const expireSession = useCallback(() => {
    if (!active.current) return;
    denyView();
    setPayment(null);
  }, [denyView]);
  const current = useCallback(
    (version: number) => active.current && version === epoch.current && !denied.current,
    [],
  );
  const api = useMemo(() => {
    const client = new ApiClient({
      baseUrl,
      maxAttempts: 2,
      getPinToken: () => pinToken.current,
      getAccessToken: async () => {
        if (!active.current || denied.current) return null;
        session.current ??= createSessionClient({ kind: 'staff', onExpired: expireSession });
        const token = await session.current.getAccessToken();
        return active.current && !denied.current ? token : null;
      },
    });
    return {
      auth: createAuthApi(client),
      bookings: createBookingApi(client),
      payments: createPaymentApi(client),
    };
  }, [baseUrl, expireSession]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      epoch.current += 1;
      session.current?.dispose();
      session.current = null;
      pinToken.current = null;
      grant.current = null;
    };
  }, []);
  const load = useCallback(async (): Promise<void> => {
    if (denied.current) return;
    const version = epoch.current;
    const read = ++reading.current;
    setError(null);
    setState({ kind: 'loading' });
    try {
      const [loaded, loadedBalance] = await Promise.all([
        api.bookings.get(bookingId),
        api.payments.balance(bookingId),
      ]);
      if (!current(version) || read !== reading.current) return;
      setBooking(loaded.data);
      setBalance(loadedBalance.data);
      setAmount(String(suggestedAmount(loaded.data, loadedBalance.data, 'DEPOSIT')));
      setState({ kind: 'ready' });
    } catch (caught) {
      if (!current(version) || read !== reading.current) return;
      if (isApiError(caught) && readFailureState(caught)) denyView();
      else {
        setState({ kind: 'ready' });
        setError(caught);
      }
    }
  }, [api, bookingId, current, denyView]);
  useEffect(() => {
    if (forced === undefined) void load();
  }, [forced, load]);
  const refreshBalance = useCallback(
    async (version: number): Promise<void> => {
      try {
        const loaded = (await api.payments.balance(bookingId)).data;
        if (current(version)) setBalance(loaded);
      } catch (caught) {
        if (!current(version)) return;
        if (isApiError(caught) && readFailureState(caught)) denyView();
        else setError(caught);
      }
    },
    [api, bookingId, current, denyView],
  );
  const lookupBalance = useCallback(() => {
    if (!denied.current) void refreshBalance(epoch.current);
    // Số dư không xác định riêng lệnh thu; giữ unknownOutcome và khoá biểu mẫu.
  }, [refreshBalance]);
  const handlePinFailure = useCallback(
    (caught: unknown) => {
      const failure = pinFailure(caught, isApiError);
      setStep(failure.locked ? 'locked' : 'idle');
      setLockedMinutes(
        failure.retryAfterSeconds === null ? null : Math.ceil(failure.retryAfterSeconds / 60),
      );
      if (failure.locked) return;
      if (
        isApiError(caught) &&
        ['E_AUTH_PIN_REQUIRED', 'E_AUTH_INVALID_CREDENTIALS'].includes(caught.code ?? '')
      )
        setWrong(true);
      else if (isApiError(caught) && readFailureState(caught)) denyView();
      else setUnavailable(true);
    },
    [denyView],
  );
  const verify = useCallback(async (): Promise<void> => {
    if (denied.current || verifying.current || sending.current) return;
    const version = epoch.current;
    if (pinIssue(pin) !== null) {
      setStep('idle');
      return;
    }
    verifying.current = true;
    setStep('verifying');
    setBusy(true);
    setUnavailable(false);
    setWrong(false);
    try {
      const token = (await api.auth.pinVerify(pin, bookingId)).data;
      if (!current(version)) return;
      setPin('');
      if (!pinGrantValid(token, Date.now())) {
        clearGrant();
        return;
      }
      grant.current = token;
      pinToken.current = token.pinToken;
      setExpiresAt(token.expiresAt);
      setStep('verified');
    } catch (caught) {
      if (current(version)) handlePinFailure(caught);
    } finally {
      verifying.current = false;
      if (current(version)) {
        setPin('');
        setBusy(false);
      }
    }
  }, [api, bookingId, clearGrant, current, handlePinFailure, pin]);
  const handleSendFailure = useCallback(
    (caught: unknown) => {
      if (isApiError(caught) && caught.code === 'E_AUTH_PIN_REQUIRED') {
        setState({ kind: 'ready' });
        return;
      }
      const failure = writeFailureState(caught, {
        attemptedVersion: '—',
        onReload: () => void load(),
        onLookup: lookupBalance,
      });
      if (failure.kind === 'forbidden') denyView();
      else setState(failure);
    },
    [denyView, load, lookupBalance],
  );
  const send = useCallback(async (): Promise<void> => {
    if (denied.current || sending.current || !canSendPayment(step, amountIssueValue)) return;
    const version = epoch.current;
    if (!pinGrantValid(grant.current, Date.now())) {
      clearGrant();
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const created = (
        await api.payments.create({
          bookingId,
          type,
          method,
          amount: Number.parseInt(amount, 10),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        })
      ).data;
      if (!current(version)) return;
      setPayment(created);
      clearGrant();
      // Payment đã xác nhận; đọc lỗi không đổi kết quả. Denial vẫn che dữ liệu.
      await refreshBalance(version);
    } catch (caught) {
      if (current(version)) handleSendFailure(caught);
    } finally {
      sending.current = false;
      if (current(version)) {
        clearGrant();
        setBusy(false);
      }
    }
  }, [
    api,
    amount,
    amountIssueValue,
    bookingId,
    clearGrant,
    current,
    handleSendFailure,
    note,
    refreshBalance,
    step,
    type,
    method,
  ]);

  if (forced !== undefined) {
    return (
      <section data-testid="collect-screen" style={{ display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{t('ops.collect.title')}</h1>
        <StateSurface state={forced} />
      </section>
    );
  }

  return (
    <section data-testid="collect-screen" style={{ display: 'grid', gap: 12, padding: '16px 0' }}>
      <h1 style={{ margin: 0 }}>{t('ops.collect.title')}</h1>
      <Link href={`/bookings/${encodeURIComponent(bookingId)}`} data-testid="collect-back">
        {t('ops.collect.back')}
      </Link>
      <StateSurface state={state}>
        {booking === null || balance === null ? null : (
          <>
            <p data-testid="collect-booking" style={{ margin: 0 }}>
              {t('ops.collect.booking', { code: booking.code, status: booking.status })}
            </p>
            <p data-testid="collect-balance" style={{ margin: 0 }}>
              {t('ops.collect.balance', {
                paid: formatMoney(balance.paidAmount),
                due: formatMoney(balance.balanceDue),
              })}
            </p>
          </>
        )}
        {error === null ? null : <ScreenAlert error={error} onRetry={() => void load()} />}
        <CollectBody
          step={step}
          pin={pin}
          pinIssueValue={pinIssue(pin)}
          lockedMinutes={lockedMinutes}
          wrong={wrong}
          unavailable={unavailable}
          balance={balance}
          booking={booking}
          type={type}
          method={method}
          amount={amount}
          note={note}
          amountIssueValue={amountIssueValue}
          payment={payment}
          busy={busy}
          onPin={setPin}
          onVerify={() => void verify()}
          onType={(value) => {
            setType(value);
            if (booking !== null && balance !== null)
              setAmount(String(suggestedAmount(booking, balance, value)));
          }}
          onMethod={setMethod}
          onAmount={setAmount}
          onNote={setNote}
          onSend={() => {
            if (canSendPayment(step, amountIssueValue)) void send();
          }}
          onPrint={() => window.print()}
        />
      </StateSurface>
    </section>
  );
}
