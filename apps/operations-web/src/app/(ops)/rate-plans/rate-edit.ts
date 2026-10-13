import type { RatePlanAdmin } from '@pinehill/contracts';
import { ratePlanDraftOf, type RatePlanDraft } from '../../../lib/rate-plans';
export function rebasePlan(
  local: RatePlanDraft,
  before: RatePlanAdmin,
  current: RatePlanAdmin,
): RatePlanDraft {
  const original = ratePlanDraftOf(before),
    next = ratePlanDraftOf(current);
  for (const key of ['depositPercent', 'minNights', 'maxNights', 'cancellationPolicyId'] as const)
    if (local[key] !== original[key]) next[key] = local[key];
  if (local.status !== original.status) next.status = local.status;
  next.reason = local.reason;
  return next;
}
