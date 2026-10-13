import { strictPlan, strictPolicy } from '../../../lib/rate-config-schemas';
import { ApiError, type ApiClient } from '@pinehill/api-client';
import {
  listResponseSchema,
  ratePlanUpdateRequestSchema,
  cancellationPolicyUpdateRequestSchema,
} from '@pinehill/contracts';
import type { AdminData, AdminReceipt } from './model';
import { completeCatalogue } from './catalogue';
import { parseRateCommand, type RateCommand } from './rate-intent';
export async function readRates(client: ApiClient, signal: AbortSignal): Promise<AdminData> {
  const [ratePlans, policies] = await Promise.all([
    completeCatalogue(client, '/rate-plans/admin', listResponseSchema(strictPlan), signal),
    completeCatalogue(client, '/cancellation-policies', listResponseSchema(strictPolicy), signal),
  ]);
  return { properties: [], roomTypes: [], ratePlans, policies };
}
export async function writeRate(
  client: ApiClient,
  command: RateCommand,
  key: string,
  signal: AbortSignal,
): Promise<AdminReceipt> {
  command = parseRateCommand(command);
  const headers = { 'x-session-request': '1' },
    spec = {
      method: 'PUT' as const,
      ifMatch: command.tag,
      idempotencyKey: key,
      signal,
      maxAttempts: 1,
      headers,
    };
  if (command.kind === 'rate-plan-put') {
    const response = await client.requestVoid({
      ...spec,
      path: '/rate-plans/' + encodeURIComponent(command.targetId),
      body: ratePlanUpdateRequestSchema.parse(command.body),
    });
    if (response.status !== 204)
      throw new ApiError({ kind: 'protocol', message: 'Invalid plan acknowledgement' });
    return {
      kind: command.kind,
      id: command.targetId,
      priorVersion: Number(command.tag.slice(1, -1)),
    };
  }
  const response = await client.request({
    ...spec,
    path: '/cancellation-policies/' + encodeURIComponent(command.targetId),
    body: cancellationPolicyUpdateRequestSchema.parse(command.body),
    decoder: strictPolicy,
  });
  if (
    response.status !== 200 ||
    response.data.id !== command.targetId ||
    response.data.version <= Number(command.tag.slice(1, -1))
  )
    throw new ApiError({ kind: 'protocol', message: 'Invalid policy acknowledgement' });
  return { kind: command.kind, data: response.data };
}
