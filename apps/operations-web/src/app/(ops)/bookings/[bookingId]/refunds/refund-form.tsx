'use client';
import type { ReactElement } from 'react';
import type { BookingSummary } from '@pinehill/contracts';
import { formatMoney, space } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_SUBTITLE_STYLE,
  opsNoticeStyle,
} from '../../../../../components/editorial-styles';
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
  const confirmTransfer = intent.action === 'confirm-transfer';
  const payments = eligiblePayments(booking.payments);
  const noteLabel = confirmTransfer
    ? t('ops.refunds.transferNote')
    : cash
      ? t('ops.refunds.bankNote')
      : t('ops.refunds.note');
  return (
    <>
      {intent.action !== 'create' ? null : (
        <>
          <p style={{ margin: 0 }}>{t('ops.refunds.createNote')}</p>
          <label style={OPS_FIELD_LABEL_STYLE}>
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
          {payments.length ? null : (
            <p role="alert" style={opsNoticeStyle('warning')}>
              {t('ops.refunds.noPayments')}
            </p>
          )}
        </>
      )}
      {intent.action !== 'approve' ? null : (
        <label style={OPS_FIELD_LABEL_STYLE}>
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
      {confirmTransfer ? (
        <label style={OPS_FIELD_LABEL_STYLE}>
          {t('ops.refunds.bankReference')}
          <input
            name="bankReference"
            maxLength={64}
            value={c.bankReference}
            disabled={c.blocked}
            onChange={(event) => c.setBankReference(event.target.value)}
          />
        </label>
      ) : null}
      <label style={OPS_FIELD_LABEL_STYLE}>
        {noteLabel}
        <textarea
          name="note"
          maxLength={500}
          value={c.note}
          disabled={c.blocked}
          onChange={(event) => c.setNote(event.target.value)}
        />
      </label>
      {!cash ? null : (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
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
        <p role="alert" data-testid="refund-issue" style={opsNoticeStyle('danger')}>
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
      className="ph-card"
      onSubmit={(event) => {
        event.preventDefault();
        void c.send();
      }}
      style={{
        display: 'grid',
        gap: space.s3,
        maxWidth: 560,
        padding: space.s4,
        minWidth: 0,
      }}
    >
      <h2 style={OPS_SUBTITLE_STYLE}>{label}</h2>
      <RefundFields c={c} booking={booking} />
      <RefundPin c={c} />
      <div className="ph-actions">
        <button
          type="submit"
          className="ph-btn-primary"
          style={OPS_COMPACT_BTN_STYLE}
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
        <button
          type="button"
          className="ph-btn"
          style={OPS_COMPACT_BTN_STYLE}
          disabled={c.busy}
          onClick={c.reset}
        >
          {t('ops.refunds.close')}
        </button>
      </div>
    </form>
  );
}
