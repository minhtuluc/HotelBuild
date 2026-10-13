import { expect, test } from 'vitest';
import {
  ratePlanDraftOf,
  ratePlanUpdateRequest,
  validateRatePlanDraft,
} from '../../src/lib/rate-plans';
import { rebasePlan } from '../../src/app/(ops)/rate-plans/rate-edit';
import { plan } from './fixture';
test('explicit version adoption preserves unrelated concurrent plan fields', () => {
  const draft = { ...ratePlanDraftOf(plan), depositPercent: '40', reason: 'Synthetic update' };
  const fresh = { ...plan, minNights: 2, maxNights: 9, version: 2 };
  expect(rebasePlan(draft, plan, fresh)).toEqual({
    ...ratePlanDraftOf(fresh),
    depositPercent: '40',
    reason: 'Synthetic update',
  });
});

test.each(['01', ' 1 ', '0001'])(
  'numeric normalization %s does not overwrite concurrent untouched values',
  (minNights) => {
    const draft = {
      ...ratePlanDraftOf(plan),
      minNights,
      maxNights: ' 007 ',
      depositPercent: '40',
      cancellationPolicyId: ' ' + plan.cancellationPolicyId + ' ',
      reason: 'Synthetic update',
    };
    expect(ratePlanUpdateRequest(draft, plan)).toEqual({
      depositPercent: 40,
      reason: 'Synthetic update',
    });
    const fresh = {
      ...plan,
      minNights: 2,
      maxNights: 9,
      cancellationPolicyId: '00000000-0000-4000-8000-000000000003',
      version: 2,
    };
    const rebased = rebasePlan(draft, plan, fresh);
    expect(rebased.minNights).toBe('2');
    expect(rebased.maxNights).toBe('9');
    expect(rebased.cancellationPolicyId).toBe('00000000-0000-4000-8000-000000000003');
    expect(ratePlanUpdateRequest(rebased, fresh)).toEqual({
      depositPercent: 40,
      reason: 'Synthetic update',
    });
  },
);
test('normalized unchanged deposit adopts server value; genuine and invalid edits remain local', () => {
  const fresh = { ...plan, depositPercent: 50, minNights: 2, maxNights: 9, version: 2 };
  const local = {
    ...ratePlanDraftOf(plan),
    depositPercent: ' 030 ',
    minNights: '03',
    maxNights: 'oops',
    reason: 'Synthetic',
  };
  const rebased = rebasePlan(local, plan, fresh);
  expect(rebased.depositPercent).toBe('50');
  expect(rebased.minNights).toBe('03');
  expect(rebased.maxNights).toBe('oops');
  expect(validateRatePlanDraft(rebased, fresh)).toContainEqual({
    field: 'maxNights',
    issue: 'OUT_OF_RANGE',
  });
});
