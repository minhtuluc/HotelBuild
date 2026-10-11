'use client';
import type { ReactElement } from 'react';
import type { BookingSummary } from '@pinehill/contracts';
import { formatMoney } from '@pinehill/ui-web';
import { t } from '../../../../../lib/i18n';
import { PinDialog } from '../collect/collect-parts';
import { pinIssue } from '../collect/collect-model';
import { cashPayout, eligiblePayments, requiresPin } from './refund-command';
import type { RefundControls } from './refund-actions';
function RefundFields({
  c,
  booking,
}: {
  c: RefundControls;
  booking: BookingSummary;
}): ReactElement | null {
  const intent = c.intent;
  if (!intent) return null;
  const cash = cashPayout(intent);
  const payments = eligiblePayments(booking.payments);
  return (
    <>
      {intent.action !== 'create' ? null : (
        <>
          <p style={{ margin: 0 }}>{t('ops.refunds.createNote')}</p>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('ops.refunds.payment')}
            <select
              name="paymentId"
              value={c.paymentId}
              disabled={c.blocked}
              onChange={(event) => c.setPaymentId(event.target.value)}
            >
              {payments.map((value) => (
                <option key={value.paymentId} value={value.paymentId}>
                  {value.method} · {formatMoney(value.amount)} · {value.paymentId}
                </option>
              ))}
            </select>
          </label>
          {payments.length ? null : <p role="alert">{t('ops.refunds.noPayments')}</p>}
        </>
      )}
      {intent.action !== 'approve' ? null : (
        <label style={{ display: 'grid', gap: 4 }}>
          {t('ops.refunds.amount')}
          <input
            name="approvedAmount"
            inputMode="numeric"
            value={c.amount}
            disabled={c.blocked}
            onChange={(event) => c.setAmount(event.target.value)}
          />
        </label>
      )}
      <label style={{ display: 'grid', gap: 4 }}>
        {cash ? t('ops.refunds.bankNote') : t('ops.refunds.note')}
        <textarea
          name="note"
          maxLength={500}
          value={c.note}
          disabled={c.blocked}
          onChange={(event) => c.setNote(event.target.value)}
        />
      </label>
      {!cash ? null : (
        <label>
          <input
            type="checkbox"
            checked={c.recipient}
            disabled={c.blocked}
            onChange={(event) => c.setRecipient(event.target.checked)}
          />
          {t('ops.refunds.recipient')}
        </label>
      )}
      {c.issue === null ? null : (
        <p role="alert" data-testid="refund-issue">
          {t(`ops.refunds.issue.${c.issue}`)}
        </p>
      )}
    </>
  );
}
function RefundPin({ c }: { c: RefundControls }): ReactElement | null {
  if (!c.intent || !requiresPin(c.intent)) return null;
  return (
    <PinDialog
      step={c.step}
      pin={c.pin}
      issue={pinIssue(c.pin)}
      lockedMinutes={c.lockedMinutes}
      wrong={c.wrong}
      unavailable={c.unavailable}
      busy={c.busy}
      onPin={c.setPin}
      onSubmit={() => void c.verify()}
      title={t('ops.refunds.pinTitle')}
      description={t('ops.refunds.pinNote')}
    />
  );
}
export function RefundForm({
  controls: c,
  booking,
}: {
  controls: RefundControls;
  booking: BookingSummary;
}): ReactElement | null {
  const intent = c.intent;
  if (!intent) return null;
  const label =
    intent.action === 'create' ? t('ops.refunds.create') : t(`ops.refunds.action.${intent.action}`);
  return (
    <form
      data-testid="refund-form"
      onSubmit={(event) => {
        event.preventDefault();
        void c.send();
      }}
      style={{
        display: 'grid',
        gap: 12,
        maxWidth: 560,
        padding: 16,
        border: '1px solid var(--color-border)',
        minWidth: 0,
      }}
    >
      <h2 style={{ margin: 0 }}>{label}</h2>
      <RefundFields c={c} booking={booking} />
      <RefundPin c={c} />
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <button
          type="submit"
          data-testid="refund-confirm"
          disabled={
            c.blocked ||
            c.issue !== null ||
            (requiresPin(intent) && c.step !== 'verified') ||
            (intent.action === 'create' && !c.paymentId)
          }
        >
          {t('ops.refunds.confirm', { action: label })}
        </button>
        <button type="button" disabled={c.busy} onClick={c.reset}>
          {t('ops.refunds.close')}
        </button>
      </div>
    </form>
  );
}
