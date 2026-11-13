'use client';
import type { ReactElement } from 'react';
import type { RefundRequest, BookingBalance, UserMe } from '@pinehill/contracts';
import { formatMoney, formatDateTimeVn, space } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_SUBTITLE_STYLE,
  OPS_TABULAR_STYLE,
  opsNoticeStyle,
} from '../../../../../components/editorial-styles';
import { t } from '../../../../../lib/i18n';
import { paidEvidence, refundActions, refundDecisionReady, payoutMethod } from './refund-model';
import type { RefundControls } from './refund-actions';
const ROW = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: 12,
  margin: 0,
} as const;
const VALUE = { margin: 0, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' } as const;
const showMoney = (value: number | undefined) => (value === undefined ? '—' : formatMoney(value));
function RefundNumbers({
  refund,
  balance,
}: {
  refund: RefundRequest;
  balance: BookingBalance;
}): ReactElement {
  return (
    <dl style={{ display: 'grid', gap: 8, margin: 0 }}>
      <div style={ROW}>
        <dt>{t('ops.refunds.gross')}</dt>
        <dd data-testid="refund-gross" style={VALUE}>
          {formatMoney(refund.approvedAmount ?? refund.requestedAmount)}
        </dd>
      </div>
      <div style={ROW}>
        <dt>{t('ops.refunds.fee')}</dt>
        <dd data-testid="refund-fee" style={VALUE}>
          {formatMoney(refund.refundFee)}
        </dd>
      </div>
      <div style={ROW}>
        <dt>{t('ops.refunds.net')}</dt>
        <dd data-testid="refund-net" style={{ ...VALUE, fontSize: 20, fontWeight: 600 }}>
          {showMoney(refund.netRefund)}
        </dd>
      </div>
      <div style={ROW}>
        <dt>{t('ops.refunds.event')}</dt>
        <dd style={VALUE}>{showMoney(refund.eventNetRefund)}</dd>
      </div>
      <div style={ROW}>
        <dt>{t('ops.refunds.reserved')}</dt>
        <dd data-testid="refund-reserved" style={VALUE}>
          {formatMoney(balance.reservedRefundAmount)}
        </dd>
      </div>
      <div style={ROW}>
        <dt>{t('ops.refunds.refunded')}</dt>
        <dd style={VALUE}>{formatMoney(balance.refundedAmount)}</dd>
      </div>
      <div style={ROW}>
        <dt>{t('ops.refunds.maker')}</dt>
        <dd style={VALUE}>{refund.requestedBy}</dd>
      </div>
      <div style={ROW}>
        <dt>{t('ops.refunds.checker')}</dt>
        <dd style={VALUE}>{refund.approvedBy ?? '—'}</dd>
      </div>
      <div style={ROW}>
        <dt>{t('ops.refunds.decided')}</dt>
        <dd style={VALUE}>{refund.decidedAt ? formatDateTimeVn(refund.decidedAt) : '—'}</dd>
      </div>
    </dl>
  );
}
export function RefundDetail({
  refund,
  balance,
  user,
  controls,
}: {
  refund: RefundRequest;
  balance: BookingBalance;
  user: UserMe;
  controls: RefundControls;
}): ReactElement {
  const confirmed = paidEvidence(refund);
  const factsReady = refundDecisionReady(refund);
  return (
    <section
      data-testid="refund-detail"
      className="ph-card"
      style={{
        display: 'grid',
        gap: space.s3,
        padding: space.s4,
        minWidth: 0,
      }}
    >
      <h2 style={{ ...OPS_SUBTITLE_STYLE, overflowWrap: 'anywhere' }}>
        {t('ops.refunds.detail', { id: refund.id })}
      </h2>
      <p data-testid="refund-status" role="status" style={VALUE}>
        {refund.status === 'PAID' && !confirmed
          ? t('ops.refunds.unverified')
          : t(`ops.refunds.status.${refund.status}`)}
      </p>
      <RefundNumbers refund={refund} balance={balance} />
      {factsReady ? null : (
        <p role="alert" style={opsNoticeStyle('danger')}>
          {t('ops.refunds.missing')}
        </p>
      )}
      {refund.requiresThresholdControl === true ? (
        <p data-testid="refund-threshold" role="note" style={opsNoticeStyle('warning')}>
          {t('ops.refunds.threshold')}
        </p>
      ) : null}
      <h3 style={{ margin: 0 }}>{t('ops.refunds.sources')}</h3>
      <ul
        data-testid={confirmed ? 'refund-paid-evidence' : 'refund-sources'}
        className="ph-list-lines"
        style={{ ...OPS_TABULAR_STYLE, margin: 0, overflowWrap: 'anywhere' }}
      >
        {(refund.refundAllocations ?? []).map((value, index) => (
          <li
            key={`${value.originalPayment.paymentId}-${index}`}
            style={{ display: 'grid', gap: 4, minWidth: 0 }}
          >
            <p style={{ margin: 0 }}>
              {t('ops.refunds.original', {
                id: value.originalPayment.paymentId,
                method: value.originalPayment.method,
                amount: formatMoney(value.originalPayment.amount),
              })}
            </p>
            <p style={{ margin: 0 }}>
              {t('ops.refunds.allocation', {
                method: value.payoutMethod,
                amount: formatMoney(value.amount),
              })}
            </p>
            <p style={{ margin: 0 }}>
              {value.refundPayment
                ? t('ops.refunds.proof', {
                    id: value.refundPayment.paymentId,
                    type: value.refundPayment.type,
                    status: value.refundPayment.status,
                    amount: formatMoney(value.refundPayment.amount),
                  })
                : t('ops.refunds.noProof')}
            </p>
          </li>
        ))}
      </ul>
      {refund.status === 'APPROVED' && payoutMethod(refund) === null ? (
        <p role="note" style={opsNoticeStyle('info')}>
          {t('ops.refunds.reconcile')}
        </p>
      ) : null}
      <div className="ph-actions">
        {refundActions(refund, user).map((action) => (
          <button
            key={action}
            type="button"
            className={action === 'approve' || action === 'pay' ? 'ph-btn-primary' : 'ph-btn'}
            style={OPS_COMPACT_BTN_STYLE}
            data-testid={`refund-action-${action}`}
            disabled={controls.blocked}
            onClick={() => controls.begin({ action, target: refund })}
          >
            {t(`ops.refunds.action.${action}`)}
          </button>
        ))}
      </div>
    </section>
  );
}
