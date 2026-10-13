import type { Page } from '@playwright/test';
import {
  ratePlanAdminSchema,
  ratePlanUpdateRequestSchema,
  cancellationPolicySchema,
  cancellationPolicyUpdateRequestSchema,
  type RatePlanAdmin,
  type CancellationPolicy,
} from '../../../../packages/contracts/src/index';
import { fulfillJson, listBody, errorBody } from '../fake-api';
export const PLAN: RatePlanAdmin = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'FLEX7',
  name: 'Synthetic',
  minNights: 1,
  maxNights: 7,
  depositPercent: 30,
  cancellationPolicyId: '00000000-0000-4000-8000-000000000002',
  status: 'ACTIVE',
  version: 3,
};
export const POLICY: CancellationPolicy = {
  id: PLAN.cancellationPolicyId,
  name: 'Synthetic policy',
  status: 'ACTIVE',
  version: 4,
  earlyCheckoutFreeHours: 72,
  earlyCheckoutRefundPct: 50,
  tiers: [168, 72, 24, 0, -1].map((offsetHours) => ({
    hoursBeforeCheckIn: Math.max(0, offsetHours),
    offsetHours,
    refundPercent: offsetHours >= 168 ? 100 : offsetHours >= 72 ? 50 : 0,
    chargeFirstNight: offsetHours <= 0,
  })),
};
export function configBackend(
  page: Page,
  { lost = false, conflict = false }: { lost?: boolean; conflict?: boolean } = {},
) {
  let plan = PLAN,
    policy = POLICY;
  const writes: { key: string; tag: string; body: string }[] = [];
  let didLose = false,
    didConflict = false;
  void page.route('**/api/session/sys/rate-plans**', async (route) => {
    if (route.request().method() === 'PUT') {
      const request = route.request();
      writes.push({
        key: request.headers()['idempotency-key'] ?? '',
        tag: request.headers()['if-match'] ?? '',
        body: request.postData() ?? '',
      });
      if (conflict && !didConflict) {
        didConflict = true;
        plan = { ...plan, minNights: 2, maxNights: 9, version: plan.version + 1 };
        return fulfillJson(
          route,
          412,
          errorBody('E_GEN_VERSION_CONFLICT', 'synthetic', '/rate-plans'),
        );
      }
      if (!didLose) {
        const raw: unknown = JSON.parse(request.postData() ?? '{}');
        plan = ratePlanAdminSchema.parse({
          ...plan,
          ...ratePlanUpdateRequestSchema.parse(raw),
          version: plan.version + 1,
        });
      }
      if (lost && !didLose) {
        didLose = true;
        return route.abort('connectionreset');
      }
      return fulfillJson(route, 204, '');
    }
    return fulfillJson(route, 200, listBody([plan]));
  });
  void page.route('**/api/session/sys/cancellation-policies**', async (route) => {
    if (route.request().method() === 'PUT') {
      const request = route.request();
      writes.push({
        key: request.headers()['idempotency-key'] ?? '',
        tag: request.headers()['if-match'] ?? '',
        body: request.postData() ?? '',
      });
      const raw: unknown = JSON.parse(request.postData() ?? '{}');
      policy = cancellationPolicySchema.parse({
        ...policy,
        ...cancellationPolicyUpdateRequestSchema.parse(raw),
        version: policy.version + 1,
      });
      return fulfillJson(route, 200, JSON.stringify(policy));
    }
    return fulfillJson(route, 200, listBody([policy]));
  });
  return { writes, plan: () => plan, policy: () => policy };
}
