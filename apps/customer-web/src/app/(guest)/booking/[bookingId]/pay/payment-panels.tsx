'use client';
import styles from './payment.module.css';
import { type ScreenState } from '@pinehill/ui-web';
import type { PaymentView } from './payment-flow';
import { approvedAmount, safePaymentUrl, type Offer } from './payment-model';
import type { PaymentCatalog } from '../../../../../i18n/catalogs';
import {
  useDateTimeVn,
  useMoney,
  usePaymentCatalog,
  usePaymentText,
} from '../../../../../i18n/client';
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
function auxiliarySurface(
  view: PaymentView,
  invalid: boolean,
  reload: () => void,
  m: PaymentCatalog,
): ScreenState {
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
  m: PaymentCatalog,
): ScreenState {
  return fixedSurface(view, reload, reference) ?? auxiliarySurface(view, invalid, reload, m);
}
export function PaymentSummary({ offer }: { offer: Offer }) {
  const fmtTime = useDateTimeVn();
  const fmtMoney = useMoney();
  const m = usePaymentCatalog();
  const text = usePaymentText();
  const amount = approvedAmount(offer.booking, offer.balance);
  const expiry = offer.booking.holdExpiresAt;
  return (
    <section aria-labelledby="payment-summary" className={styles.card}>
      <h2 id="payment-summary">{text('summaryBooking', { code: offer.booking.code })}</h2>
      <dl className={styles.summaryList}>
        <div className={styles.summaryRow}>
          <dt>{m.total}</dt>
          <dd>{fmtMoney(offer.balance.totalAmount)}</dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>{m.paid}</dt>
          <dd>{fmtMoney(offer.balance.paidAmount)}</dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>{m.balance}</dt>
          <dd>{fmtMoney(offer.balance.balanceDue)}</dd>
        </div>
        {amount !== null ? (
          <div className={styles.summaryRow}>
            <dt>{m.deposit}</dt>
            <dd data-testid="approved-deposit" className={styles.depositValue}>
              {fmtMoney(amount)}
            </dd>
          </div>
        ) : null}
        <div className={styles.summaryRow}>
          <dt>{m.bookingStatus}</dt>
          <dd data-testid="server-booking-status">{offer.booking.status}</dd>
        </div>
      </dl>
      {expiry ? (
        <p className={styles.note}>{text('holdExpiry', { time: fmtTime(expiry) })}</p>
      ) : null}
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
  const m = usePaymentCatalog();
  const text = usePaymentText();
  if (!['ready', 'confirm'].includes(view.phase) || view.changed) return null;
  return (
    <div className={styles.card}>
      <fieldset disabled={view.busy || view.phase === 'confirm'} className={styles.fieldset}>
        <legend>{m.provider}</legend>
        <div className={styles.providers}>
          {(['VNPAY', 'MOMO'] as const).map((value) => (
            <label key={value} className={styles.providerOption}>
              <input
                type="radio"
                name="method"
                value={value}
                checked={method === value}
                onChange={() => onMethod(value)}
              />
              <span>{value === 'VNPAY' ? m.providerVnpay : m.providerMomo}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {view.phase === 'confirm' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <p className={styles.statusBox}>
            {m.confirmInfo}{' '}
            {text('selectedProvider', {
              provider: method === 'VNPAY' ? m.providerVnpay : m.providerMomo,
            })}
          </p>
          <div className="ph-actions">
            <button
              className="ph-btn-accent ph-btn-lg"
              type="button"
              disabled={view.busy}
              onClick={onConfirm}
            >
              {m.confirm}
            </button>
          </div>
        </div>
      ) : (
        <div className="ph-actions">
          <button
            className="ph-btn-accent ph-btn-lg"
            type="button"
            disabled={view.busy}
            onClick={onPrepare}
          >
            {m.prepare}
          </button>
        </div>
      )}
    </div>
  );
}
function portalUrl(view: PaymentView, fixtureOrigin?: string): string | null {
  const payment = view.payment;
  if (!view.fullPayment || !payment || payment.status !== 'PENDING') return null;
  if (payment.expiresAt !== null && Date.now() >= Date.parse(payment.expiresAt)) return null;
  return safePaymentUrl(view.fullPayment, fixtureOrigin);
}
function observedMessage(view: PaymentView, m: PaymentCatalog): string {
  const map: Partial<Record<PaymentView['phase'], string>> = {
    received: m.received,
    confirmed: m.confirmed,
    failed: m.failed,
  };
  return map[view.phase] ?? m.pending;
}
export function PaymentDetails({
  view,
  fixtureOrigin,
}: {
  view: PaymentView;
  fixtureOrigin?: string | undefined;
}) {
  const fmtTime = useDateTimeVn();
  const fmtMoney = useMoney();
  const m = usePaymentCatalog();
  const text = usePaymentText();
  const payment = view.payment;
  if (!payment) return null;
  const portal = portalUrl(view, fixtureOrigin);
  return (
    <section aria-labelledby="payment-observed" className={styles.card}>
      <h2 id="payment-observed">{m.observed}</h2>
      <p style={{ margin: 0 }} className="ph-tabular">
        {m.transaction} <span style={{ overflowWrap: 'anywhere' }}>{payment.paymentId}</span>
      </p>
      <p style={{ margin: 0 }} className="ph-tabular">
        {text('paymentStatus', { amount: fmtMoney(payment.amount), status: payment.status })}
      </p>
      <p role="status" data-testid="payment-result" className={styles.statusBox}>
        {observedMessage(view, m)}
      </p>
      {payment.expiresAt ? (
        <p className={styles.note}>{text('paymentExpiry', { time: fmtTime(payment.expiresAt) })}</p>
      ) : null}
      {portal ? (
        <div className="ph-actions">
          <a href={portal} rel="noreferrer" className="ph-btn-accent ph-btn-lg">
            {m.portal}
          </a>
        </div>
      ) : null}
      <p className={styles.note}>{m.poll}</p>
    </section>
  );
}
