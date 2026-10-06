'use client';

/**
 * SCR-70 — Gói giá & chính sách huỷ (UC-RATE-06, BR-CANCEL-01,02,09, BR-RATE-16,20).
 * Hai bảng cùng màn: gói giá (đọc tuyến OWNER) và chính sách huỷ (toàn bộ bậc + ngoại lệ trả phòng sớm).
 * Sửa bằng `PUT` + `If-Match`; `412`/`428` giữ bản nhập và hiện bảng khác biệt (chỉ khi chọn
 * "Dùng bản máy chủ" mới thay); `422 E_RATE_CONFIGURATION_INVALID` tô đúng hàng bậc lỗi.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createRateApi, isApiError } from '@pinehill/api-client';
import type {
  CancellationPolicy,
  CancellationPolicyUpdateRequest,
  RatePlanAdmin,
  RatePlanUpdateRequest,
} from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';
import {
  ifMatchOf,
  policyDiff,
  policyDraftOf,
  policyUpdateRequest,
  ratePlanDiff,
  ratePlanDraftOf,
  ratePlanUpdateRequest,
  tierIndexFromField,
  validatePolicyDraft,
  validateRatePlanDraft,
  type CancellationPolicyDraft,
  type RatePlanDraft,
} from '../../../lib/rate-plans';
import {
  ConflictPanel,
  PolicyEditor,
  PolicyList,
  RatePlanEditor,
  RatePlanTable,
  type Conflict,
  type ServerTierIssue,
} from './rate-plans-widgets';

const CONFLICT_STATUS: ReadonlySet<number> = new Set([412, 428]);

function isConflict(error: unknown): boolean {
  return isApiError(error) && error.status !== undefined && CONFLICT_STATUS.has(error.status);
}

/** `422 E_RATE_CONFIGURATION_INVALID` kèm chỉ số bậc (`tiers[2].…`) → tô đúng hàng (AC5). */
function serverTierIssues(error: unknown): ServerTierIssue[] {
  if (!isApiError(error) || error.code !== 'E_RATE_CONFIGURATION_INVALID') return [];
  return (error.details ?? []).flatMap((detail) => {
    const index = tierIndexFromField(detail.field);
    return index === null ? [] : [{ index, issue: detail.issue }];
  });
}

export function RatePlansScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [plans, setPlans] = useState<readonly RatePlanAdmin[]>([]);
  const [policies, setPolicies] = useState<readonly CancellationPolicy[]>([]);
  const [planDraft, setPlanDraft] = useState<RatePlanDraft | null>(null);
  const [policyDraft, setPolicyDraft] = useState<CancellationPolicyDraft | null>(null);
  const [tierServerIssues, setTierServerIssues] = useState<readonly ServerTierIssue[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const canEdit = state.kind !== 'forbidden';

  const load = useCallback(async (): Promise<void> => {
    setReadError(null);
    try {
      const api = createRateApi(opsApiClient(baseUrl));
      const [plansPage, policiesPage] = await Promise.all([
        api.listRatePlansAdmin(),
        api.listCancellationPolicies(),
      ]);
      setPlans(plansPage.data.data);
      setPolicies(policiesPage.data.data);
      setState({ kind: 'ready' });
    } catch (caught) {
      const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
      if (mapped !== undefined) {
        setState(mapped);
        return;
      }
      setReadError(caught);
      setState({ kind: 'ready' });
    }
  }, [baseUrl]);

  useEffect(() => {
    if (forced !== undefined) return;
    void load();
  }, [forced, load]);

  const submitRatePlan = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (planDraft === null) return;
    const plan = plans.find((item) => item.id === planDraft.id);
    if (plan === undefined) return;
    const issues = validateRatePlanDraft(planDraft, plan);
    if (issues.length > 0) {
      setState({ kind: 'validationError', details: issues });
      return;
    }
    const request: RatePlanUpdateRequest = ratePlanUpdateRequest(planDraft, plan);
    try {
      await createRateApi(opsApiClient(baseUrl)).updateRatePlan(
        planDraft.id,
        request,
        ifMatchOf(plan.version),
      );
      setSaved(planDraft.code);
      setPlanDraft(null);
      setConflict(null);
      await load();
    } catch (caught) {
      setConflict(null);
      if (isConflict(caught)) {
        await showRatePlanConflict(planDraft, plan.version);
        return;
      }
      setState(
        writeFailureState(caught, {
          attemptedVersion: String(plan.version),
          onReload: () => void load(),
          onLookup: () => void load(),
        }),
      );
    }
  };

  const submitPolicy = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (policyDraft === null) return;
    const policy = policies.find((item) => item.id === policyDraft.id);
    if (policy === undefined) return;
    setTierServerIssues([]);
    const issues = validatePolicyDraft(policyDraft, policy);
    if (issues.length > 0) {
      setState({ kind: 'validationError', details: issues });
      return;
    }
    const request: CancellationPolicyUpdateRequest = policyUpdateRequest(policyDraft);
    try {
      await createRateApi(opsApiClient(baseUrl)).updateCancellationPolicy(
        policyDraft.id,
        request,
        ifMatchOf(policy.version),
      );
      setSaved(policy.name);
      setPolicyDraft(null);
      setConflict(null);
      await load();
    } catch (caught) {
      setConflict(null);
      if (isConflict(caught)) {
        await showPolicyConflict(policyDraft, policy.version);
        return;
      }
      setTierServerIssues(serverTierIssues(caught));
      setState(
        writeFailureState(caught, {
          attemptedVersion: String(policy.version),
          onReload: () => void load(),
          onLookup: () => void load(),
        }),
      );
    }
  };

  /** 412/428: đọc lại bản máy chủ và hiện bảng khác biệt, giữ nguyên bản nhập (AC6). */
  const showRatePlanConflict = async (
    draft: RatePlanDraft,
    attemptedVersion: number,
  ): Promise<void> => {
    try {
      const page = await createRateApi(opsApiClient(baseUrl)).listRatePlansAdmin();
      const server = page.data.data.find((item) => item.id === draft.id);
      if (server === undefined) {
        setState({
          kind: 'conflict',
          currentVersion: 'chưa rõ',
          attemptedVersion: String(attemptedVersion),
          onReload: () => void load(),
        });
        return;
      }
      setConflict({ kind: 'ratePlan', entity: server, diff: ratePlanDiff(draft, server) });
      setState({ kind: 'ready' });
    } catch (caught) {
      setReadError(caught);
      setState({ kind: 'ready' });
    }
  };

  const showPolicyConflict = async (
    draft: CancellationPolicyDraft,
    attemptedVersion: number,
  ): Promise<void> => {
    try {
      const page = await createRateApi(opsApiClient(baseUrl)).listCancellationPolicies();
      const server = page.data.data.find((item) => item.id === draft.id);
      if (server === undefined) {
        setState({
          kind: 'conflict',
          currentVersion: 'chưa rõ',
          attemptedVersion: String(attemptedVersion),
          onReload: () => void load(),
        });
        return;
      }
      setConflict({ kind: 'policy', entity: server, diff: policyDiff(draft, server) });
      setState({ kind: 'ready' });
    } catch (caught) {
      setReadError(caught);
      setState({ kind: 'ready' });
    }
  };

  /** "Dùng bản máy chủ": thay bản nhập bằng bản máy chủ, xoá bảng khác biệt. */
  const useServerVersion = (): void => {
    if (conflict === null) return;
    if (conflict.kind === 'ratePlan') {
      setPlanDraft(ratePlanDraftOf(conflict.entity));
    } else {
      setPolicyDraft(policyDraftOf(conflict.entity));
    }
    setConflict(null);
  };

  if (forced !== undefined) {
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  }

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('ratePlans.title')}</h1>
      <p style={{ margin: 0 }}>{t('ratePlans.intro')}</p>
      <StateSurface state={state}>
        {readError === null ? null : <ScreenAlert error={readError} onRetry={() => void load()} />}
        {saved === null ? null : (
          <p role="status" data-testid="rate-plans-saved" style={{ margin: 0 }}>
            {t('ratePlans.saved', { code: saved })}
          </p>
        )}
        {conflict === null ? null : (
          <ConflictPanel
            conflict={conflict}
            onUseServer={useServerVersion}
            onKeep={() => setConflict(null)}
          />
        )}
        <h2 style={{ margin: 0 }}>{t('ratePlans.planSection')}</h2>
        {plans.length === 0 ? null : (
          <RatePlanTable
            plans={plans}
            policies={policies}
            canEdit={canEdit}
            onEdit={(plan) => {
              setSaved(null);
              setConflict(null);
              setPolicyDraft(null);
              setPlanDraft(ratePlanDraftOf(plan));
            }}
          />
        )}
        {planDraft === null ? null : (
          <RatePlanEditor
            draft={planDraft}
            policies={policies}
            onCancel={() => setPlanDraft(null)}
            onChange={setPlanDraft}
            onSubmit={(event) => void submitRatePlan(event)}
          />
        )}
        <h2 style={{ margin: 0 }}>{t('ratePlans.policySection')}</h2>
        {policies.length === 0 ? null : (
          <PolicyList
            policies={policies}
            canEdit={canEdit}
            onEdit={(policy) => {
              setSaved(null);
              setConflict(null);
              setPlanDraft(null);
              setTierServerIssues([]);
              setPolicyDraft(policyDraftOf(policy));
            }}
          />
        )}
        {policyDraft === null ? null : (
          <PolicyEditor
            draft={policyDraft}
            serverIssues={tierServerIssues}
            onCancel={() => setPolicyDraft(null)}
            onChange={setPolicyDraft}
            onSubmit={(event) => void submitPolicy(event)}
          />
        )}
      </StateSurface>
    </section>
  );
}
