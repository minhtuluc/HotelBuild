'use client';
import styles from './payment.module.css';
import { formatDateTimeVn, formatMoney, type ScreenState } from '@pinehill/ui-web';
import type { PaymentView } from './payment-flow';
import { approvedAmount, safePaymentUrl, type Offer } from './payment-model';
import { messages as m, paymentText as text } from './messages-payment';
export type MethodChoice = 'VNPAY' | 'MOMO' | '';
function blockedSurface(view: PaymentView, reload: () => void): ScreenState {
  const expiry = view.offer?.booking.holdExpiresAt;
  return expiry && Date.parse(expiry) <= Date.now()
    ? { kind: 'expired', expiresAt: expiry, onReload: reload }
    : { kind: 'empty', reason: 'noData', canCreate: false };
}
function fixedSurface(
  view: PaymentView,
  reload: () => void,
  reference: string,
): ScreenState | null {
  switch (view.phase) {
    case 'loading':
      return { kind: 'loading' };
    case 'forbidden':
      return { kind: 'forbidden' };
    case 'unknown':
      return { kind: 'unknownOutcome', referenceId: reference, onLookup: reload };
    case 'blocked':
      return blockedSurface(view, reload);
    case 'confirmed':
      return { kind: 'success' };
    default:
      return null;
  }
}
function auxiliarySurface(view: PaymentView, invalid: boolean, reload: () => void): ScreenState {
  if (view.changed)
    return {
      kind: 'conflict',
      currentVersion: String(view.offer?.booking.version ?? m.currentVersion),
      attemptedVersion: m.previousVersion,
      onReload: reload,
    };
  if (invalid)
    return {
      kind: 'validationError',
      details: [{ field: 'method', issue: m.methodRequired }],
    };
  if (view.busy && view.offer)
    return {
      kind: 'refreshing',
      updatedAt: view.checkedAt ?? new Date().toISOString(),
      stale: true,
    };
  return { kind: 'ready' };
}
export function paymentSurface(
  view: PaymentView,
  invalid: boolean,
  reload: () => void,
  reference: string,
): ScreenState {
  return fixedSurface(view, reload, reference) ?? auxiliarySurface(view, invalid, reload);
}
export function PaymentSummary({ offer }: { offer: Offer }) {
  const amount = approvedAmount(offer.booking, offer.balance);
  const expiry = offer.booking.holdExpiresAt;
  return (
    <section aria-labelledby="payment-summary">
      <h2 id="payment-summary">{text('summaryBooking', { code: offer.booking.code })}</h2>
      <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '8px 16px' }}>
        <dt>{m.total}</dt>
        <dd style={{ margin: 0 }}>{formatMoney(offer.balance.totalAmount)}</dd>
        <dt>{m.paid}</dt>
        <dd style={{ margin: 0 }}>{formatMoney(offer.balance.paidAmount)}</dd>
        <dt>{m.balance}</dt>
        <dd style={{ margin: 0 }}>{formatMoney(offer.balance.balanceDue)}</dd>
        {amount !== null ? (
          <>
            <dt>{m.deposit}</dt>
            <dd data-testid="approved-deposit" style={{ margin: 0, fontWeight: 700 }}>
              {formatMoney(amount)}
            </dd>
          </>
        ) : null}
        <dt>{m.bookingStatus}</dt>
        <dd data-testid="server-booking-status" style={{ margin: 0 }}>
          {offer.booking.status}
        </dd>
      </dl>
      {expiry ? <p>{text('holdExpiry', { time: formatDateTimeVn(expiry) })}</p> : null}
    </section>
  );
}
export function PaymentForm({
  view,
  method,
  onMethod,
  onPrepare,
  onConfirm,
}: {
  view: PaymentView;
  method: MethodChoice;
  onMethod: (m: 'VNPAY' | 'MOMO') => void;
  onPrepare: () => void;
  onConfirm: () => void;
}) {
  if (!['ready', 'confirm'].includes(view.phase) || view.changed) return null;
  return (
    <>
      <fieldset disabled={view.busy || view.phase === 'confirm'}>
        <legend>{m.provider}</legend>
        {(['VNPAY', 'MOMO'] as const).map((value) => (
          <label
            key={value}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              marginRight: 24,
              padding: '8px 0',
            }}
          >
            <input
              type="radio"
              name="method"
              value={value}
              checked={method === value}
              onChange={() => onMethod(value)}
            />
            {value === 'VNPAY' ? m.providerVnpay : m.providerMomo}
          </label>
        ))}
      </fieldset>
      {view.phase === 'confirm' ? (
        <>
          <p>
            {m.confirmInfo}{' '}
            {text('selectedProvider', {
              provider: method === 'VNPAY' ? m.providerVnpay : m.providerMomo,
            })}
          </p>
          <button className={styles.primary} type="button" disabled={view.busy} onClick={onConfirm}>
            {m.confirm}
          </button>
        </>
      ) : (
        <button className={styles.primary} type="button" disabled={view.busy} onClick={onPrepare}>
          {m.prepare}
        </button>
      )}
    </>
  );
}
function portalUrl(view: PaymentView, fixtureOrigin?: string): string | null {
  const payment = view.payment;
  if (!view.fullPayment || !payment || payment.status !== 'PENDING') return null;
  if (payment.expiresAt !== null && Date.now() >= Date.parse(payment.expiresAt)) return null;
  return safePaymentUrl(view.fullPayment, fixtureOrigin);
}
function observedMessage(view: PaymentView): string {
  const text: Partial<Record<PaymentView['phase'], string>> = {
    received: m.received,
    confirmed: m.confirmed,
    failed: m.failed,
  };
  return text[view.phase] ?? m.pending;
}
export function PaymentDetails({
  view,
  fixtureOrigin,
}: {
  view: PaymentView;
  fixtureOrigin?: string | undefined;
}) {
  const payment = view.payment;
  if (!payment) return null;
  const portal = portalUrl(view, fixtureOrigin);
  return (
    <section aria-labelledby="payment-observed">
      <h2 id="payment-observed">{m.observed}</h2>
      <p>
        {m.transaction} <span style={{ overflowWrap: 'anywhere' }}>{payment.paymentId}</span>
      </p>
      <p>
        {text('paymentStatus', { amount: formatMoney(payment.amount), status: payment.status })}
      </p>
      <p role="status" data-testid="payment-result">
        {observedMessage(view)}
      </p>
      {payment.expiresAt ? (
        <p>{text('paymentExpiry', { time: formatDateTimeVn(payment.expiresAt) })}</p>
      ) : null}
      {portal ? (
        <a href={portal} rel="noreferrer">
          {m.portal}
        </a>
      ) : null}
      <p>{m.poll}</p>
    </section>
  );
}
