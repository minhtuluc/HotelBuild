import { useEffect, useState, type FormEvent } from 'react';
import type { RatePlanAdmin, CancellationPolicy } from '@pinehill/contracts';
import {
  ifMatchOf,
  ratePlanDraftOf,
  policyDraftOf,
  ratePlanUpdateRequest,
  policyUpdateRequest,
  validateRatePlanDraft,
  validatePolicyDraft,
  ratePlanDiff,
  policyDiff,
  type RatePlanDraft,
  type CancellationPolicyDraft,
} from '../../../lib/rate-plans';
import { useAdmin } from '../admin-commands/use-admin';
import { rebasePlan } from './rate-edit';
import { rateText as rs } from './messages-session';
import type { Conflict } from './rate-plans-widgets';
type Edit = (
  | { kind: 'plan'; baseline: RatePlanAdmin; draft: RatePlanDraft }
  | { kind: 'policy'; baseline: CancellationPolicy; draft: CancellationPolicyDraft }
) & { revision: number };
export function useRateConfig(enabled: boolean) {
  const { state, controller } = useAdmin('rate-config', enabled);
  const [edit, setEdit] = useState<Edit | null>(null),
    [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    setEdit(null);
    setSaved(null);
  }, [state.actorRevision]);
  useEffect(() => {
    if (!state.actorVerified) {
      setEdit(null);
      setSaved(null);
    }
  }, [state.actorVerified]);
  useEffect(() => {
    if (state.receipt?.kind === 'rate-plan-put' || state.receipt?.kind === 'policy-put') {
      setSaved(edit?.kind === 'plan' ? edit.draft.code : (edit?.baseline.name ?? rs('configName')));
      setEdit(null);
    }
  }, [state.receipt]);
  const visible = visibleEdit(edit, state);
  const startPlan = (plan: RatePlanAdmin) => {
    if (controller?.canStart()) {
      setSaved(null);
      setEdit({
        kind: 'plan',
        baseline: plan,
        draft: ratePlanDraftOf(plan),
        revision: state.actorRevision,
      });
    }
  };
  const startPolicy = (policy: CancellationPolicy) => {
    if (controller?.canStart()) {
      setSaved(null);
      setEdit({
        kind: 'policy',
        baseline: policy,
        draft: policyDraftOf(policy),
        revision: state.actorRevision,
      });
    }
  };
  const setPlan = (draft: RatePlanDraft) => {
    if (visible?.kind === 'plan' && controller?.canStart()) {
      controller.clearValidation();
      setEdit({ ...visible, draft });
    }
  };
  const setPolicy = (draft: CancellationPolicyDraft) => {
    if (visible?.kind === 'policy' && controller?.canStart()) {
      controller.clearValidation();
      setEdit({ ...visible, draft });
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!visible || !controller?.canStart()) return;
    if (visible.kind === 'plan') {
      const issues = validateRatePlanDraft(visible.draft, visible.baseline);
      if (issues.length) {
        controller.validation(issues);
        return;
      }
      await controller.save({
        kind: 'rate-plan-put',
        targetId: visible.draft.id,
        tag: ifMatchOf(visible.draft.version),
        body: ratePlanUpdateRequest(visible.draft, visible.baseline),
      });
    } else {
      const issues = validatePolicyDraft(visible.draft, visible.baseline);
      if (issues.length) {
        controller.validation(
          issues.map((issue) => ({
            field: 'index' in issue ? `tiers[${issue.index}].${issue.field}` : issue.field,
            issue: issue.issue,
          })),
        );
        return;
      }
      await controller.save({
        kind: 'policy-put',
        targetId: visible.draft.id,
        tag: ifMatchOf(visible.draft.version),
        body: policyUpdateRequest(visible.draft),
      });
    }
  };
  const conflict = comparison(visible, state);
  const adopt = (keep: boolean) => {
    if (!conflict || !visible || !controller || state.busy) return;
    setEdit(adoptDraft(visible, conflict, keep));
    controller.adoptVersion();
  };
  return {
    state,
    controller,
    edit: visible,
    saved: state.actorVerified && state.canWrite && state.receipt ? saved : null,
    startPlan,
    startPolicy,
    setPlan,
    setPolicy,
    submit,
    conflict,
    adopt,
    cancel: () => {
      if (!state.busy && state.phase !== 'unknown') setEdit(null);
    },
  };
}
function visibleEdit(
  edit: Edit | null,
  state: import('../admin-commands/model').AdminState,
): Edit | null {
  return edit &&
    edit.revision === state.actorRevision &&
    state.actorVerified &&
    state.canWrite &&
    state.data
    ? edit
    : null;
}
function comparison(
  edit: Edit | null,
  state: import('../admin-commands/model').AdminState,
): Conflict | null {
  if (state.phase !== 'conflict' || !state.canCompare || !edit || !state.data) return null;
  if (edit.kind === 'plan') {
    const plan = state.data.ratePlans?.find((row) => row.id === edit.draft.id);
    return plan ? { kind: 'ratePlan', entity: plan, diff: ratePlanDiff(edit.draft, plan) } : null;
  }
  const policy = state.data.policies?.find((row) => row.id === edit.draft.id);
  return policy ? { kind: 'policy', entity: policy, diff: policyDiff(edit.draft, policy) } : null;
}
function adoptDraft(edit: Edit, conflict: Conflict, keep: boolean): Edit {
  if (conflict.kind === 'ratePlan' && edit.kind === 'plan')
    return {
      ...edit,
      baseline: conflict.entity,
      draft: keep
        ? rebasePlan(edit.draft, edit.baseline, conflict.entity)
        : ratePlanDraftOf(conflict.entity),
    };
  if (conflict.kind === 'policy' && edit.kind === 'policy')
    return {
      ...edit,
      baseline: conflict.entity,
      draft: keep
        ? { ...edit.draft, version: conflict.entity.version }
        : policyDraftOf(conflict.entity),
    };
  return edit;
}
