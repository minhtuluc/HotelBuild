import type { RefundRequest } from '@pinehill/contracts';
import { payoutLookupRequired } from './refund-model';
// A browser guard, not a replacement for the server's durable payout operation.
// Only an opaque namespace and a random command key persist; no financial/session data.
async function namespace(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return `pinehill-refund-payout-v1:${Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('')}`;
}
async function locked<T>(id: string, operation: (key: string) => T): Promise<T> {
  if (!navigator.locks) throw new Error('Payout coordination unavailable');
  const key = await namespace(id);
  return navigator.locks.request(key, () => operation(key));
}
export async function claimPayout(id: string): Promise<{ claimed: boolean; key: string }> {
  return locked(id, (name) => {
    const previous = localStorage.getItem(name);
    if (previous !== null) return { claimed: false, key: previous };
    const key = crypto.randomUUID();
    localStorage.setItem(name, key);
    if (localStorage.getItem(name) !== key) throw new Error('Payout guard unavailable');
    return { claimed: true, key };
  });
}
export async function pendingPayout(refunds: RefundRequest[]): Promise<RefundRequest | null> {
  let pending: RefundRequest | null = null;
  for (const refund of refunds) {
    const present = await locked(refund.id, (name) => {
      // Keep the opaque marker after success: a stale prepared tab must not claim a new key.
      return payoutLookupRequired(refund) && localStorage.getItem(name) !== null;
    });
    if (present) pending ??= refund;
  }
  return pending;
}
