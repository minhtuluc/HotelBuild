import { expect, test } from 'vitest';
import {
  policyDraftOf,
  ratePlanDraftOf,
  validatePolicyDraft,
  validateRatePlanDraft,
} from '../../src/lib/rate-plans';
import { policy, plan } from './fixture';
test('too-long policy reason is a field error before full-body construction', () => {
  const draft = { ...policyDraftOf(policy), reason: 'x'.repeat(501), earlyCheckoutFreeHours: '1' };
  expect(validatePolicyDraft(draft, policy)).toContainEqual({ field: 'reason', issue: 'TOO_LONG' });
});
test('too-long plan reason cannot pass local command validation', () => {
  const draft = { ...ratePlanDraftOf(plan), reason: 'x'.repeat(501), depositPercent: '40' };
  expect(validateRatePlanDraft(draft, plan)).toContainEqual({ field: 'reason', issue: 'TOO_LONG' });
});
