import { expect, test } from 'vitest';
import { ratePlanDraftOf } from '../../src/lib/rate-plans';
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
