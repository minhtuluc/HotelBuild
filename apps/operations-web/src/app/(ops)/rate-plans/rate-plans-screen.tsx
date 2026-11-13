'use client';
import type { ReactElement } from 'react';
import { StateSurface } from '@pinehill/ui-web';
import {
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_SUBTITLE_STYLE,
  OPS_TABLE_WRAP_STYLE,
  OPS_TITLE_STYLE,
  opsNoticeStyle,
} from '../../../components/editorial-styles';
import { useForcedState } from '../../../components/forced-state';
import { t } from '../../../lib/i18n';
import { tierIndexFromField } from '../../../lib/rate-plans';
import { AdminPanels } from '../admin-commands/panels';
import {
  ConflictPanel,
  RatePlanTable,
  RatePlanEditor,
  PolicyList,
  PolicyEditor,
} from './rate-plans-widgets';
import { useRateConfig } from './use-rate-config';
import { rateText as rs } from './messages-session';
export function RatePlansScreen(): ReactElement {
  const forced = useForcedState(),
    model = useRateConfig(forced === undefined);
  if (forced !== undefined)
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  return <RateContent model={model} />;
}
type Model = ReturnType<typeof useRateConfig>;
function RateContent({ model }: { model: Model }): ReactElement {
  const { state, controller } = model;
  return (
    <section style={OPS_PAGE_STYLE}>
      <header style={OPS_HEADER_STYLE}>
        <h1 style={OPS_TITLE_STYLE}>{t('ratePlans.title')}</h1>
        <p style={OPS_INTRO_STYLE}>{t('ratePlans.intro')}</p>
      </header>
      <AdminPanels
        state={state}
        controller={controller}
        version={String(model.edit?.draft.version ?? '—')}
      />
      <Saved saved={model.saved} />
      <Comparison model={model} />
      <RateLists model={model} />
      <Editor model={model} />
    </section>
  );
}
function Saved({ saved }: { saved: string | null }): ReactElement | null {
  if (saved === null) return null;
  return (
    <p role="status" data-testid="rate-plans-saved" style={opsNoticeStyle('success')}>
      {rs('confirmed', { code: saved })}
    </p>
  );
}
function Comparison({ model }: { model: Model }): ReactElement | null {
  if (!model.conflict) return null;
  return (
    <ConflictPanel
      conflict={model.conflict}
      onUseServer={() => model.adopt(false)}
      onKeep={() => model.adopt(true)}
    />
  );
}
function RateLists({ model }: { model: Model }): ReactElement | null {
  if (!model.state.data) return null;
  return (
    <>
      <h2 style={OPS_SUBTITLE_STYLE}>{t('ratePlans.planSection')}</h2>
      <Plans model={model} />
      <h2 style={OPS_SUBTITLE_STYLE}>{t('ratePlans.policySection')}</h2>
      <Policies model={model} />
    </>
  );
}
function Plans({ model }: { model: Model }): ReactElement {
  const plans = model.state.data?.ratePlans;
  if (!plans?.length) return <p>{rs('emptyPlans')}</p>;
  return (
    <div role="region" aria-label={rs('planTable')} tabIndex={0} style={OPS_TABLE_WRAP_STYLE}>
      <RatePlanTable
        plans={plans}
        policies={model.state.data?.policies ?? []}
        canEdit={model.controller?.canStart() ?? false}
        onEdit={model.startPlan}
      />
    </div>
  );
}
function Policies({ model }: { model: Model }): ReactElement {
  const policies = model.state.data?.policies;
  if (!policies?.length) return <p>{rs('emptyPolicies')}</p>;
  return (
    <PolicyList
      policies={policies}
      canEdit={model.controller?.canStart() ?? false}
      onEdit={model.startPolicy}
    />
  );
}
function Editor({ model }: { model: Model }): ReactElement | null {
  const { edit, state, controller } = model;
  if (!edit) return null;
  const serverIssues = state.issues.flatMap((detail) => {
    const index = tierIndexFromField(detail.field);
    return index === null ? [] : [{ index, issue: detail.issue }];
  });
  return (
    <fieldset
      disabled={state.busy || !controller?.canStart()}
      style={{ minWidth: 0, maxWidth: '100%', border: 0, padding: 0, margin: 0 }}
    >
      <legend>
        {edit.kind === 'plan' ? t('ratePlans.planSection') : t('ratePlans.policySection')}
      </legend>
      {edit.kind === 'plan' ? (
        <RatePlanEditor
          draft={edit.draft}
          policies={state.data?.policies ?? []}
          onChange={model.setPlan}
          onCancel={model.cancel}
          onSubmit={(event) => void model.submit(event)}
        />
      ) : (
        <PolicyEditor
          draft={edit.draft}
          serverIssues={serverIssues}
          onChange={model.setPolicy}
          onCancel={model.cancel}
          onSubmit={(event) => void model.submit(event)}
        />
      )}
    </fieldset>
  );
}
