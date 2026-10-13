'use client';
import type { FormEvent, ReactElement } from 'react';
import { validateTiers, type CancellationPolicyDraft, type TierRow } from '../../../lib/rate-plans';
import { parseInteger, tierOffset } from '../../../lib/rate-policy-tiers';
import { t } from '../../../lib/i18n';
import { rateText as rs } from './messages-session';
import type { ServerTierIssue } from './rate-plans-widgets';
const FIELD_STYLE = { display: 'grid', gap: 4 } as const;
export function PolicyEditor({
  draft,
  serverIssues,
  onCancel,
  onChange,
  onSubmit,
}: {
  draft: CancellationPolicyDraft;
  serverIssues: readonly ServerTierIssue[];
  onCancel: () => void;
  onChange: (draft: CancellationPolicyDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): ReactElement {
  const localIssues = validateTiers(draft.tiers);
  const issueAt = (index: number): string | null => {
    const local = localIssues.find((issue) => issue.index === index);
    if (local !== undefined) return local.issue;
    const server = serverIssues.find((issue) => issue.index === index);
    return server?.issue ?? null;
  };
  const setTier = (index: number, row: Partial<TierRow>): void => {
    const tiers = draft.tiers.map((current, i) => (i === index ? { ...current, ...row } : current));
    onChange({ ...draft, tiers });
  };
  const removeTier = (index: number): void => {
    onChange({ ...draft, tiers: draft.tiers.filter((_, i) => i !== index) });
  };
  const addTier = (): void => {
    onChange({
      ...draft,
      tiers: [
        ...draft.tiers,
        { hoursBeforeCheckIn: '', offsetHours: '', refundPercent: '', chargeFirstNight: false },
      ],
    });
  };
  return (
    <form
      data-testid="policy-editor"
      onSubmit={onSubmit}
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}
    >
      <legend>
        {t('ratePlans.form.legend.policy', { name: draft.id, version: draft.version })}
      </legend>
      <p role="note">{rs('offsetHelp')}</p>
      {draft.tiers.map((tier, index) => {
        const issue = issueAt(index);
        return (
          <div
            key={index}
            data-testid={`tier-row-${index}`}
            data-issue={issue ?? ''}
            style={{
              display: 'flex',
              gap: 'var(--space-s2, 8px)',
              alignItems: 'end',
              flexWrap: 'wrap',
              overflowWrap: 'anywhere',
              border: issue === null ? undefined : '1px solid var(--color-danger, red)',
            }}
          >
            <label style={FIELD_STYLE}>
              {t('ratePlans.form.hours')}
              <input
                name={`hoursBeforeCheckIn-${index}`}
                value={tier.offsetHours ?? String(tierOffset(tier) ?? '')}
                onChange={(event) => {
                  const raw = event.target.value,
                    value = parseInteger(raw);
                  setTier(index, {
                    offsetHours: raw,
                    hoursBeforeCheckIn: value !== null && value < 0 ? '0' : raw,
                  });
                }}
              />
            </label>
            <label style={FIELD_STYLE}>
              {t('ratePlans.form.refund')}
              <input
                name={`refundPercent-${index}`}
                value={tier.refundPercent}
                onChange={(event) => setTier(index, { refundPercent: event.target.value })}
              />
            </label>
            <label style={FIELD_STYLE}>
              <input
                type="checkbox"
                name={`chargeFirstNight-${index}`}
                checked={tier.chargeFirstNight ?? false}
                onChange={(event) => setTier(index, { chargeFirstNight: event.target.checked })}
              />
              {rs('firstNightRow', { index: index + 1 })}
            </label>
            {tierOffset(tier) === -1 ? <span>{rs('catchAll')}</span> : null}
            {issue === null ? null : <span role="alert">{issue}</span>}
            <button type="button" onClick={() => removeTier(index)}>
              {t('ratePlans.removeTier')}
            </button>
          </div>
        );
      })}
      <button type="button" onClick={addTier}>
        {t('ratePlans.addTier')}
      </button>
      <label style={FIELD_STYLE}>
        {t('ratePlans.form.earlyFreeHours')}
        <input
          name="earlyCheckoutFreeHours"
          value={draft.earlyCheckoutFreeHours}
          onChange={(event) => onChange({ ...draft, earlyCheckoutFreeHours: event.target.value })}
        />
      </label>
      <label style={FIELD_STYLE}>
        {t('ratePlans.form.earlyRefundPct')}
        <input
          name="earlyCheckoutRefundPct"
          value={draft.earlyCheckoutRefundPct}
          onChange={(event) => onChange({ ...draft, earlyCheckoutRefundPct: event.target.value })}
        />
      </label>
      <label style={FIELD_STYLE}>
        {t('ratePlans.form.reason')}
        <input
          name="reason"
          value={draft.reason}
          onChange={(event) => onChange({ ...draft, reason: event.target.value })}
        />
      </label>
      <p role="note" style={{ margin: 0 }}>
        {t('ratePlans.roundingNote')}
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-s2, 8px)' }}>
        <button type="submit">{t('ratePlans.save')}</button>
        <button type="button" onClick={onCancel}>
          {t('ratePlans.cancel')}
        </button>
      </div>
    </form>
  );
}
