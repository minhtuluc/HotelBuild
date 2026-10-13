import {
  ratePlanUpdateRequestSchema,
  cancellationPolicyUpdateRequestSchema,
  type RatePlanUpdateRequest,
  type CancellationPolicyUpdateRequest,
} from '@pinehill/contracts';
export type RateCommand =
  | { kind: 'rate-plan-put'; targetId: string; tag: string; body: RatePlanUpdateRequest }
  | { kind: 'policy-put'; targetId: string; tag: string; body: CancellationPolicyUpdateRequest };
export function parseRateCommand(value: Record<string, unknown>): RateCommand {
  const id = value.targetId,
    tag = value.tag;
  if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
    throw Error('Invalid rate target');
  if (
    typeof tag !== 'string' ||
    !/^"[1-9]\d*"$/.test(tag) ||
    BigInt(tag.slice(1, -1)) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw Error('Invalid rate version');
  if (value.kind === 'rate-plan-put')
    return {
      kind: value.kind,
      targetId: id,
      tag,
      body: ratePlanUpdateRequestSchema.parse(value.body),
    };
  if (value.kind === 'policy-put')
    return {
      kind: value.kind,
      targetId: id,
      tag,
      body: cancellationPolicyUpdateRequestSchema.parse(value.body),
    };
  throw Error('Wrong rate command');
}
export function isRateCommand(command: { kind: string }): command is RateCommand {
  return command.kind === 'rate-plan-put' || command.kind === 'policy-put';
}
