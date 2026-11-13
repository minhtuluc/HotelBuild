'use client';

/** Phần trình bày SCR-36 (HB-108): biểu mẫu lý do, bảng xem trước hoàn tiền, thang bậc, kết quả huỷ. */
import type { ReactElement } from 'react';
import { formatDateTimeVn, formatMoney, space } from '@pinehill/ui-web';
import type { CancelPreview, CancelResponse, CancellationPolicy } from '@pinehill/contracts';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_SUBTITLE_STYLE,
  OPS_TABLE_WRAP_STYLE,
  OPS_TABULAR_STYLE,
  opsNoticeStyle,
} from '../../../../../components/editorial-styles';
import { t } from '../../../../../lib/i18n';
import {
  CANCEL_REASONS,
  CANCEL_REASON_KEYS,
  PARTIAL_CANCEL_SUPPORTED,
  ladderRows,
  refundRows,
  type CancelDraft,
} from './cancel-model';

const REFUND_KEYS = {
  paid: 'ops.cancel.refund.paid',
  requested: 'ops.cancel.refund.requested',
  penalty: 'ops.cancel.refund.penalty',
  fee: 'ops.cancel.refund.fee',
} as const;

export function CancelForm({
  draft,
  busy,
  onChange,
  onPreview,
  onConfirm,
  canConfirm,
}: {
  draft: CancelDraft;
  busy: boolean;
  onChange: (patch: Partial<CancelDraft>) => void;
  onPreview: () => void;
  onConfirm: () => void;
  canConfirm: boolean;
}): ReactElement {
  return (
    <div className="ph-card" style={{ display: 'grid', gap: space.s3, padding: space.s4 }}>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('ops.cancel.reason')}
        <select
          name="reason"
          value={draft.reason}
          disabled={busy}
          onChange={(event) => {
            const value = CANCEL_REASONS.find((reason) => reason === event.target.value);
            if (value !== undefined) onChange({ reason: value });
          }}
        >
          {CANCEL_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {t(CANCEL_REASON_KEYS[reason])}
            </option>
          ))}
        </select>
      </label>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('ops.cancel.note')}
        <textarea
          name="note"
          maxLength={500}
          value={draft.note}
          disabled={busy}
          onChange={(event) => {
            onChange({ note: event.target.value });
          }}
        />
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
        <input
          name="forceMajeure"
          type="checkbox"
          checked={draft.isForceMajeure}
          disabled={busy}
          onChange={(event) => {
            onChange({ isForceMajeure: event.target.checked });
          }}
        />
        {t('ops.cancel.forceMajeure')}
      </label>
      <label style={OPS_FIELD_LABEL_STYLE}>
        {t('ops.cancel.evidence')}
        <textarea
          name="evidence"
          value={draft.evidence}
          disabled={busy}
          onChange={(event) => {
            onChange({ evidence: event.target.value });
          }}
        />
      </label>
      <div style={{ display: 'flex', gap: space.s2, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="ph-btn"
          style={OPS_COMPACT_BTN_STYLE}
          data-testid="cancel-preview"
          disabled={busy}
          onClick={onPreview}
        >
          {t('ops.cancel.preview.run')}
        </button>
        <button
          type="button"
          className="ph-btn-primary"
          style={OPS_COMPACT_BTN_STYLE}
          data-testid="cancel-confirm"
          disabled={busy || !canConfirm}
          onClick={onConfirm}
        >
          {t('ops.cancel.confirm')}
        </button>
      </div>
    </div>
  );
}

function Ladder({ policy, hours }: { policy: CancellationPolicy; hours: number }): ReactElement {
  return (
    <div style={OPS_TABLE_WRAP_STYLE}>
      <table data-testid="cancel-ladder" style={OPS_TABULAR_STYLE}>
        <caption
          style={{ textAlign: 'left', padding: `${space.s3}px ${space.s4}px`, fontWeight: 600 }}
        >
          {t('ops.cancel.ladder', { name: policy.name })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('ops.cancel.ladder.hours')}</th>
            <th scope="col">{t('ops.cancel.ladder.percent')}</th>
            <th scope="col">{t('ops.cancel.ladder.label')}</th>
          </tr>
        </thead>
        <tbody>
          {ladderRows(policy, hours).map((row) => (
            <tr key={`${row.hours}-${row.percent}`} aria-current={row.applied ? 'true' : undefined}>
              <td>{row.hours}</td>
              <td>{row.percent}%</td>
              <td>{row.applied ? t('ops.cancel.ladder.applied') : (row.label ?? '—')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CancelPreviewPanel({
  preview,
  policy,
}: {
  preview: CancelPreview;
  policy: CancellationPolicy | null;
}): ReactElement {
  const breakdown = preview.cancellation;
  return (
    <section
      data-testid="cancel-preview-panel"
      aria-labelledby="cancel-preview-title"
      className="ph-card"
      style={{ display: 'grid', gap: space.s3, padding: space.s4 }}
    >
      <h2 id="cancel-preview-title" style={OPS_SUBTITLE_STYLE}>
        {t('ops.cancel.preview.title')}
      </h2>
      <p style={{ margin: 0 }} data-testid="cancel-tier">
        {t('ops.cancel.preview.tier', {
          tier: breakdown.appliedTierId,
          hours: breakdown.hoursBeforeCheckIn,
          percent: breakdown.refundPercent,
        })}
      </p>
      <div style={OPS_TABLE_WRAP_STYLE}>
        <table data-testid="cancel-refund" style={OPS_TABULAR_STYLE}>
          <tbody>
            {refundRows(breakdown).map((row) => (
              <tr key={row.key}>
                <th scope="row">{t(REFUND_KEYS[row.key])}</th>
                <td>{formatMoney(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {policy === null ? null : <Ladder policy={policy} hours={breakdown.hoursBeforeCheckIn} />}
      <p style={opsNoticeStyle('neutral')} data-testid="cancel-partial-gap">
        {PARTIAL_CANCEL_SUPPORTED ? t('ops.cancel.partial.ready') : t('ops.cancel.partial.pending')}
      </p>
    </section>
  );
}

export function CancelResult({ result }: { result: CancelResponse }): ReactElement {
  return (
    <section
      data-testid="cancel-result"
      aria-labelledby="cancel-result-title"
      style={opsNoticeStyle('success')}
    >
      <h2 id="cancel-result-title" style={OPS_SUBTITLE_STYLE}>
        {t('ops.cancel.result.title')}
      </h2>
      <p style={{ margin: 0 }} data-testid="cancel-result-status">
        {t('ops.cancel.result.status', { status: result.status })}
      </p>
      <p style={{ margin: 0 }}>
        {t('ops.cancel.result.at', { time: formatDateTimeVn(result.cancelledAt) })}
      </p>
      <p style={{ margin: 0 }}>
        {t('ops.cancel.result.released', { count: result.releasedAssignmentCount })}
      </p>
      <p style={{ margin: 0 }} data-testid="cancel-result-refund">
        {result.refundRequest === null
          ? t('ops.cancel.result.noRefund')
          : t('ops.cancel.result.refund', {
              id: result.refundRequest.id,
              status: result.refundRequest.status,
              amount:
                result.refundRequest.approvedAmount === null
                  ? t('ops.cancel.result.refundPending')
                  : formatMoney(result.refundRequest.approvedAmount),
            })}
      </p>
    </section>
  );
}
