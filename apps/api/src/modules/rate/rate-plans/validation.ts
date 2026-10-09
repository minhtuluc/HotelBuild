import { z } from 'zod';
import { ratePlanUpdateRequestSchema } from '@pinehill/contracts';
import type { Prisma, rate_plans } from '@prisma/client';
import { invalid, configuration, pageQuery, reason } from './support.js';
export const publicQuery = pageQuery.extend({
  propertyId: z
    .uuid()
    .transform((v) => v.toLowerCase())
    .optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
});
export type PublicQuery = z.infer<typeof publicQuery>;
export function nights(query: PublicQuery): number | undefined {
  if (query.checkIn === undefined && query.checkOut === undefined) return undefined;
  if (query.checkIn === undefined || query.checkOut === undefined) throw invalid();
  const date = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw invalid();
    const time = Date.parse(`${s}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== s) throw invalid();
    return time;
  };
  const n = (date(query.checkOut) - date(query.checkIn)) / 86400000;
  if (!Number.isSafeInteger(n) || n <= 0) throw invalid();
  return n;
}
export function planInput(value: unknown) {
  const p = ratePlanUpdateRequestSchema.safeParse(value);
  if (!p.success) configuration(p.error.issues[0]?.path.join('.') || 'request', 'INVALID_VALUE');
  if (p.data.cancellationPolicyId && !z.uuid().safeParse(p.data.cancellationPolicyId).success)
    configuration('cancellationPolicyId', 'INVALID_VALUE');
  return {
    ...p.data,
    reason: reason(p.data.reason),
    ...(p.data.cancellationPolicyId
      ? { cancellationPolicyId: p.data.cancellationPolicyId.toLowerCase() }
      : {}),
  };
}
export function validateStay(input: ReturnType<typeof planInput>, before: rate_plans): void {
  const min = input.minNights ?? before.min_nights,
    max = input.maxNights ?? before.max_nights;
  if (min > max || max > 32767) configuration('minNights', 'INVALID_STAY_RANGE');
}
export function planData(
  input: ReturnType<typeof planInput>,
  now: Date,
): Prisma.rate_plansUncheckedUpdateInput {
  return {
    ...(input.depositPercent === undefined ? {} : { deposit_percent: input.depositPercent }),
    ...(input.minNights === undefined ? {} : { min_nights: input.minNights }),
    ...(input.maxNights === undefined ? {} : { max_nights: input.maxNights }),
    ...(input.cancellationPolicyId === undefined
      ? {}
      : { cancellation_policy_id: input.cancellationPolicyId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    // An explicit update records its own version even when only the reason changes.
    updated_at: now,
  };
}
