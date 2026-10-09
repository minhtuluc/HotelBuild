'use client';

/** Phần trình bày SCR-36 (HB-108): biểu mẫu lý do, bảng xem trước hoàn tiền, thang bậc, kết quả huỷ. */
import type { ReactElement } from 'react';
import { formatDateTimeVn, formatMoney } from '@pinehill/ui-web';
import type { CancelPreview, CancelResponse, CancellationPolicy } from '@pinehill/contracts';
import { t } from '../../../../../lib/i18n';
import {
  CANCEL_REASONS,
  CANCEL_REASON_KEYS,
  PARTIAL_CANCEL_SUPPORTED,
  ladderRows,
  refundRows,
  type CancelDraft,
} from './cancel-model';

const CELL = { padding: '4px 12px 4px 0', textAlign: 'left' } as const;

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
    <div style={{ display: 'grid', gap: 8 }}>
      <label style={{ display: 'grid', gap: 4 }}>
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
      <label style={{ display: 'grid', gap: 4 }}>
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
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
      <label style={{ display: 'grid', gap: 4 }}>
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" data-testid="cancel-preview" disabled={busy} onClick={onPreview}>
          {t('ops.cancel.preview.run')}
        </button>
        <button
          type="button"
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
    <table data-testid="cancel-ladder">
      <caption style={{ textAlign: 'left', paddingBottom: 4 }}>
        {t('ops.cancel.ladder', { name: policy.name })}
      </caption>
      <thead>
        <tr>
          <th scope="col" style={CELL}>
            {t('ops.cancel.ladder.hours')}
          </th>
          <th scope="col" style={CELL}>
            {t('ops.cancel.ladder.percent')}
          </th>
          <th scope="col" style={CELL}>
            {t('ops.cancel.ladder.label')}
          </th>
        </tr>
      </thead>
      <tbody>
        {ladderRows(policy, hours).map((row) => (
          <tr key={`${row.hours}-${row.percent}`} aria-current={row.applied ? 'true' : undefined}>
            <td style={CELL}>{row.hours}</td>
            <td style={CELL}>{row.percent}%</td>
            <td style={CELL}>
              {row.applied ? t('ops.cancel.ladder.applied') : (row.label ?? '—')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
      style={{ display: 'grid', gap: 8 }}
    >
      <h2 id="cancel-preview-title" style={{ margin: 0 }}>
        {t('ops.cancel.preview.title')}
      </h2>
      <p style={{ margin: 0 }} data-testid="cancel-tier">
        {t('ops.cancel.preview.tier', {
          tier: breakdown.appliedTierId,
          hours: breakdown.hoursBeforeCheckIn,
          percent: breakdown.refundPercent,
        })}
      </p>
      <table data-testid="cancel-refund">
        <tbody>
          {refundRows(breakdown).map((row) => (
            <tr key={row.key}>
              <th scope="row" style={CELL}>
                {t(REFUND_KEYS[row.key])}
              </th>
              <td style={CELL}>{formatMoney(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {policy === null ? null : <Ladder policy={policy} hours={breakdown.hoursBeforeCheckIn} />}
      <p style={{ margin: 0 }} data-testid="cancel-partial-gap">
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
      style={{ display: 'grid', gap: 8 }}
    >
      <h2 id="cancel-result-title" style={{ margin: 0 }}>
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
