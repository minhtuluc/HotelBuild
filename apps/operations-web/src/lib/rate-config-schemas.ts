import {
  ratePlanAdminSchema,
  cancellationPolicySchema,
  cancellationPolicyUpdateRequestSchema,
  listQuerySchema,
} from '@pinehill/contracts';
export const strictPlan = ratePlanAdminSchema
  .strict()
  .refine((row) => Number.isSafeInteger(row.version) && row.version >= 1);
const strictTiers = cancellationPolicySchema.shape.tiers.element.strict().array().min(1);
export const strictPolicy = cancellationPolicySchema
  .extend({ tiers: strictTiers })
  .strict()
  .refine((row) => Number.isSafeInteger(row.version) && row.version >= 1);
export const policyBody = cancellationPolicyUpdateRequestSchema.extend({ tiers: strictTiers });
export const configQuery = listQuerySchema.pick({ limit: true, cursor: true });
export const policyQuery = configQuery.extend({
  status: cancellationPolicySchema.shape.status.optional(),
});
