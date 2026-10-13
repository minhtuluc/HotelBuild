import { ApiClient } from '@pinehill/api-client';
import type { AdminCommand } from '../../src/app/(ops)/admin-commands/intent';
import { adminPorts } from '../../src/app/(ops)/admin-commands/api';
export const plan = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'FLEX7' as const,
  name: 'Synthetic',
  minNights: 1,
  maxNights: 7,
  depositPercent: 30,
  cancellationPolicyId: '00000000-0000-4000-8000-000000000002',
  status: 'ACTIVE' as const,
  version: 1,
};
export const policy = {
  id: plan.cancellationPolicyId,
  name: 'Synthetic',
  status: 'ACTIVE' as const,
  version: 1,
  earlyCheckoutFreeHours: 0,
  earlyCheckoutRefundPct: 0,
  tiers: [{ hoursBeforeCheckIn: 0, offsetHours: -1, refundPercent: 0, chargeFirstNight: true }],
};
export const actor = {
  userId: 'synthetic-owner',
  username: 'synthetic',
  fullName: 'Synthetic',
  role: 'OWNER' as const,
  propertyScope: [],
  hasPin: true,
  mustChangePassword: false,
};
export const command = {
  kind: 'rate-plan-put',
  targetId: plan.id,
  tag: '"1"',
  body: { depositPercent: 40, reason: 'Synthetic update' },
} satisfies AdminCommand;
export const policyCommand = {
  kind: 'policy-put',
  targetId: policy.id,
  tag: '"1"',
  body: {
    tiers: policy.tiers,
    earlyCheckoutFreeHours: 0,
    earlyCheckoutRefundPct: 0,
    reason: 'Synthetic update',
  },
} satisfies AdminCommand;
export const data = { properties: [], roomTypes: [], ratePlans: [plan], policies: [policy] };
export function network() {
  const calls: {
    path: string;
    method: string;
    key: string | null;
    tag: string | null;
    marker: string | null;
    body: unknown;
  }[] = [];
  let writeStatus = 204,
    policyVersion = 2,
    fail = false;
  function recordCall(
    url: URL,
    init: RequestInit | undefined,
    headers: Headers,
    method: string,
  ): void {
    calls.push({
      path: url.pathname,
      method,
      key: headers.get('idempotency-key'),
      tag: headers.get('if-match'),
      marker: headers.get('x-session-request'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
  }
  const client = new ApiClient({
    baseUrl: 'https://synthetic.test/api/session/sys',
    getAccessToken: () => 'synthetic-access',
    maxAttempts: 1,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input)),
        headers = new Headers(init?.headers),
        method = init?.method ?? 'GET';
      recordCall(url, init, headers, method);
      if (method === 'PUT') {
        if (fail) throw TypeError('Synthetic lost response');
        if (url.pathname.includes('/cancellation-policies/'))
          return Response.json({ ...policy, version: policyVersion });
        return new Response(null, { status: writeStatus });
      }
      if (url.pathname.endsWith('/auth/me')) return Response.json(actor);
      const rows = url.pathname.endsWith('/rate-plans/admin') ? [plan] : [policy];
      return Response.json({
        data: rows,
        meta: { limit: 100, total: rows.length, hasMore: false, nextCursor: null },
      });
    },
  });
  return {
    ports: adminPorts(client, 'rate-config'),
    calls,
    status: (status: number) => {
      writeStatus = status;
    },
    version: (version: number) => {
      policyVersion = version;
    },
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
