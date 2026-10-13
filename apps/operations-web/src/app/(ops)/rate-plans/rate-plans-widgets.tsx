'use client';

/** Các khối giao diện của SCR-70: bảng gói giá/chính sách, form sửa, bảng khác biệt khi 412. */
import type { FormEvent, ReactElement } from 'react';
import type { CancellationPolicy, RatePlanAdmin } from '@pinehill/contracts';
import { formatStatusWithEnum } from '@pinehill/ui-web';
import { t } from '../../../lib/i18n';
import { type DiffRow, type RatePlanDraft } from '../../../lib/rate-plans';

/** Lỗi theo bậc do server trả (`E_RATE_CONFIGURATION_INVALID` đã trích chỉ số). */
export interface ServerTierIssue {
  index: number;
  issue: string;
}

/** Bảng khác biệt khi 412: giữ bản nhập, so với bản máy chủ vừa đọc lại. */
export type Conflict =
  | { kind: 'ratePlan'; entity: RatePlanAdmin; diff: DiffRow[] }
  | { kind: 'policy'; entity: CancellationPolicy; diff: DiffRow[] };

import { wireOffset } from '../../../lib/rate-policy-tiers';
import { rateText as rs } from './messages-session';
export { PolicyEditor } from './policy-editor';

const FIELD_STYLE = { display: 'grid', gap: 4 } as const;

export function ConflictPanel({
  conflict,
  onUseServer,
  onKeep,
}: {
  conflict: Conflict;
  onUseServer: () => void;
  onKeep: () => void;
}): ReactElement {
  return (
    <div
      role="alert"
      data-testid="rate-plans-conflict"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <p style={{ margin: 0 }}>{t('ratePlans.conflict.title')}</p>
      {conflict.kind === 'policy' ? <p>{rs('keepPolicy')}</p> : null}
      <div
        role="region"
        tabIndex={0}
        aria-label={t('ratePlans.conflict.title')}
        style={{ maxWidth: '100%', overflowX: 'auto' }}
      >
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th scope="col">{rs('field')}</th>
              <th scope="col" style={{ textAlign: 'start' }}>
                {t('ratePlans.conflict.local')}
              </th>
              <th scope="col" style={{ textAlign: 'start' }}>
                {t('ratePlans.conflict.server')}
              </th>
            </tr>
          </thead>
          <tbody>
            {conflict.diff.map((row) => (
              <tr key={row.label}>
                <th scope="row">{fieldLabel(row.label)}</th>
                <td data-testid={`diff-local-${row.label}`}>{fieldValue(row.label, row.local)}</td>
                <td data-testid={`diff-server-${row.label}`}>
                  {fieldValue(row.label, row.server)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={onUseServer}>
        {t('ratePlans.conflict.useServer')}
      </button>
      <button type="button" onClick={onKeep}>
        {rs('adoptLocal')}
      </button>
    </div>
  );
}

export function RatePlanTable({
  plans,
  policies,
  canEdit,
  onEdit,
}: {
  plans: readonly RatePlanAdmin[];
  policies: readonly CancellationPolicy[];
  canEdit: boolean;
  onEdit: (plan: RatePlanAdmin) => void;
}): ReactElement {
  const policyName = (id: string): string =>
    policies.find((policy) => policy.id === id)?.name ?? id;
  const headers = [
    t('ratePlans.col.code'),
    t('ratePlans.col.name'),
    t('ratePlans.col.deposit'),
    t('ratePlans.col.minNights'),
    t('ratePlans.col.maxNights'),
    t('ratePlans.col.policy'),
    t('ratePlans.col.status'),
    t('ratePlans.col.version'),
    t('ratePlans.col.actions'),
  ];
  return (
    <table data-testid="rate-plans-table" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {headers.map((label) => (
            <th key={label} scope="col" style={{ textAlign: 'start' }}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {plans.map((plan) => (
          <tr key={plan.id} data-testid={`rate-plan-${plan.code}`}>
            <td>{t(`enum.ratePlanCode.${plan.code}`)}</td>
            <td>{plan.name}</td>
            <td>{plan.depositPercent}%</td>
            <td>{plan.minNights}</td>
            <td>{plan.maxNights}</td>
            <td>{policyName(plan.cancellationPolicyId)}</td>
            <td>{formatStatusWithEnum(t(`ratePlans.status.${plan.status}`), plan.status)}</td>
            <td>{plan.version}</td>
            <td>
              {canEdit ? (
                <button type="button" onClick={() => onEdit(plan)}>
                  {t('ratePlans.edit')}
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PolicyList({
  policies,
  canEdit,
  onEdit,
}: {
  policies: readonly CancellationPolicy[];
  canEdit: boolean;
  onEdit: (policy: CancellationPolicy) => void;
}): ReactElement {
  return (
    <div data-testid="policies-list" style={{ display: 'grid', gap: 'var(--space-s4, 16px)' }}>
      {policies.map((policy) => (
        <section
          key={policy.id}
          data-testid={`policy-${policy.id}`}
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <h3 style={{ margin: 0 }}>
            {policy.name}{' '}
            {formatStatusWithEnum(t(`ratePlans.status.${policy.status}`), policy.status)}
          </h3>
          <p style={{ margin: 0 }}>
            {t('ratePlans.col.version')}: {policy.version}
          </p>
          <table data-testid={`policy-tiers-${policy.id}`} style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'start' }}>
                  {t('ratePlans.col.hours')}
                </th>
                <th scope="col" style={{ textAlign: 'start' }}>
                  {t('ratePlans.col.refund')}
                </th>
                <th scope="col">{rs('firstNight')}</th>
              </tr>
            </thead>
            <tbody>
              {policy.tiers.map((tier) => (
                <tr key={wireOffset(tier)}>
                  <td>{wireOffset(tier) === -1 ? rs('catchAll') : `${wireOffset(tier)}h`}</td>
                  <td>{tier.refundPercent}%</td>
                  <td>{tier.chargeFirstNight ? rs('yes') : rs('no')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: 0 }}>
            {t('ratePlans.col.early')}:{' '}
            {policy.earlyCheckoutFreeHours === 0 && policy.earlyCheckoutRefundPct === 0
              ? t('ratePlans.early.none')
              : `${policy.earlyCheckoutFreeHours}h · ${policy.earlyCheckoutRefundPct}%`}
          </p>
          {canEdit ? (
            <button type="button" onClick={() => onEdit(policy)}>
              {t('ratePlans.edit')}
            </button>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function parsePlanStatus(value: string): RatePlanDraft['status'] {
  return value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
}

export function RatePlanEditor({
  draft,
  policies,
  onCancel,
  onChange,
  onSubmit,
}: {
  draft: RatePlanDraft;
  policies: readonly CancellationPolicy[];
  onCancel: () => void;
  onChange: (draft: RatePlanDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): ReactElement {
  return (
    <form
      data-testid="rate-plan-editor"
      onSubmit={onSubmit}
      style={{ display: 'flex', gap: 'var(--space-s2, 8px)', flexWrap: 'wrap', alignItems: 'end' }}
    >
      <legend>
        {t('ratePlans.form.legend.plan', { code: draft.code, version: draft.version })}
      </legend>
      <label style={FIELD_STYLE}>
        {t('ratePlans.form.deposit')}
        <input
          name="depositPercent"
          value={draft.depositPercent}
          onChange={(event) => onChange({ ...draft, depositPercent: event.target.value })}
        />
      </label>
      <label style={FIELD_STYLE}>
        {t('ratePlans.form.minNights')}
        <input
          name="minNights"
          value={draft.minNights}
          onChange={(event) => onChange({ ...draft, minNights: event.target.value })}
        />
      </label>
      <label style={FIELD_STYLE}>
        {t('ratePlans.form.maxNights')}
        <input
          name="maxNights"
          value={draft.maxNights}
          onChange={(event) => onChange({ ...draft, maxNights: event.target.value })}
        />
      </label>
      <label style={FIELD_STYLE}>
        {t('ratePlans.form.policy')}
        <select
          name="cancellationPolicyId"
          value={draft.cancellationPolicyId}
          onChange={(event) => onChange({ ...draft, cancellationPolicyId: event.target.value })}
        >
          {policies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.name}
            </option>
          ))}
        </select>
      </label>
      <label style={FIELD_STYLE}>
        {t('ratePlans.form.status')}
        <select
          name="status"
          value={draft.status}
          onChange={(event) => onChange({ ...draft, status: parsePlanStatus(event.target.value) })}
        >
          <option value="ACTIVE">{t('ratePlans.status.ACTIVE')}</option>
          <option value="INACTIVE">{t('ratePlans.status.INACTIVE')}</option>
        </select>
      </label>
      <label style={FIELD_STYLE}>
        {t('ratePlans.form.reason')}
        <input
          name="reason"
          value={draft.reason}
          onChange={(event) => onChange({ ...draft, reason: event.target.value })}
        />
      </label>
      <p role="note" style={{ margin: 0, flexBasis: '100%' }}>
        {t('ratePlans.snapshotNote')}
      </p>
      <button type="submit">{t('ratePlans.save')}</button>
      <button type="button" onClick={onCancel}>
        {t('ratePlans.cancel')}
      </button>
    </form>
  );
}

function fieldLabel(field: string): string {
  const names: Record<string, string> = {
    depositPercent: t('ratePlans.form.deposit'),
    minNights: t('ratePlans.form.minNights'),
    maxNights: t('ratePlans.form.maxNights'),
    cancellationPolicyId: t('ratePlans.form.policy'),
    status: t('ratePlans.form.status'),
    earlyCheckoutFreeHours: t('ratePlans.form.earlyFreeHours'),
    earlyCheckoutRefundPct: t('ratePlans.form.earlyRefundPct'),
  };
  const tier = /^tiers\[(\d+)\]\.(offsetHours|refundPercent|chargeFirstNight)$/.exec(field);
  if (tier) {
    const label =
      tier[2] === 'offsetHours'
        ? t('ratePlans.form.hours')
        : tier[2] === 'refundPercent'
          ? t('ratePlans.form.refund')
          : rs('firstNight');
    return `${Number(tier[1]) + 1}. ${label}`;
  }
  return names[field] ?? field;
}
function fieldValue(field: string, value: string): string {
  if (field.endsWith('.chargeFirstNight') && ['true', 'false'].includes(value))
    return value === 'true' ? rs('yes') : rs('no');
  return value;
}
