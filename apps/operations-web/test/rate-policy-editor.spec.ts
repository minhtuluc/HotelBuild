import { expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { policyDraftOf } from '../src/lib/rate-plans';
import { PolicyEditor, PolicyList } from '../src/app/(ops)/rate-plans/rate-plans-widgets';
const policy = {
  id: 'synthetic',
  name: 'Synthetic',
  status: 'ACTIVE' as const,
  version: 1,
  earlyCheckoutFreeHours: 0,
  earlyCheckoutRefundPct: 0,
  tiers: [
    { hoursBeforeCheckIn: 0, offsetHours: 0, refundPercent: 0, chargeFirstNight: true },
    { hoursBeforeCheckIn: 0, offsetHours: -1, refundPercent: 0, chargeFirstNight: true },
  ],
};
test('actual policy editor exposes canonical -1 and the server first-night flag', () => {
  const html = renderToStaticMarkup(
    createElement(PolicyEditor, {
      draft: policyDraftOf(policy),
      serverIssues: [],
      onCancel: () => {},
      onChange: () => {},
      onSubmit: () => {},
    }),
  );
  expect(html.match(/<input\b[^>]*name="hoursBeforeCheckIn-1"[^>]*>/)?.[0]).toContain('value="-1"');
  expect(html.match(/<input\b[^>]*name="chargeFirstNight-0"[^>]*>/)?.[0]).toContain('checked');
});
test('actual policy list distinguishes check-in0 from catch-all -1 and displays first-night flags', () => {
  const html = renderToStaticMarkup(
    createElement(PolicyList, { policies: [policy], canEdit: false, onEdit: () => {} }),
  );
  expect(html).toContain('0h');
  expect(html).toContain('−1');
  expect(html).toContain('Tính đêm đầu');
});
