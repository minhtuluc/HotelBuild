import { ApiClient, ApiError } from '@pinehill/api-client';
import {
  listResponseSchema,
  propertySummarySchema,
  roomSummarySchema,
  roomBlockSchema,
  roomBlockCreateRequestSchema,
} from '@pinehill/contracts';
import type { AdminData, AdminReceipt } from './model';
import type { AdminCommand } from './intent';
import { completeCatalogue } from './catalogue';
export type BlockCommand = Extract<
  AdminCommand,
  { kind: 'room-block-create' | 'room-block-delete' }
>;
export function isBlockCommand(command: AdminCommand): command is BlockCommand {
  return command.kind === 'room-block-create' || command.kind === 'room-block-delete';
}
export async function readBlocks(client: ApiClient, signal: AbortSignal): Promise<AdminData> {
  const properties = await completeCatalogue(
    client,
    '/properties',
    listResponseSchema(propertySummarySchema),
    signal,
  );
  const rooms = await completeCatalogue(
    client,
    '/rooms',
    listResponseSchema(roomSummarySchema),
    signal,
  );
  const blocks = await completeCatalogue(
    client,
    '/room-blocks',
    listResponseSchema(roomBlockSchema),
    signal,
  );
  return { properties, roomTypes: [], rooms, blocks };
}
export async function writeBlock(
  client: ApiClient,
  command: BlockCommand,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<AdminReceipt> {
  const headers = { 'x-session-request': '1' };
  if (command.kind === 'room-block-delete') {
    const result = await client.requestVoid({
      method: 'DELETE',
      path: '/room-blocks/' + encodeURIComponent(command.targetId),
      query: { reason: command.reason },
      idempotencyKey,
      headers,
      signal,
      maxAttempts: 1,
    });
    if (result.status !== 204)
      throw new ApiError({ kind: 'protocol', message: 'Expected room block deletion204' });
    return { kind: 'room-block-delete', id: command.targetId };
  }
  {
    const result = await client.request({
      method: 'POST',
      path: '/room-blocks',
      body: roomBlockCreateRequestSchema.parse(command.body),
      idempotencyKey,
      headers,
      signal,
      maxAttempts: 1,
      decoder: roomBlockSchema,
    });
    if (result.status !== 201)
      throw new ApiError({ kind: 'protocol', message: 'Expected room block creation201' });
    const data = result.data;
    if (
      data.roomId !== command.body.roomId ||
      data.startDate !== command.body.startDate ||
      data.endDate !== command.body.endDate ||
      data.reason !== command.body.reason
    )
      throw new ApiError({ kind: 'protocol', message: 'Mismatched room block receipt' });
    return { kind: 'room-block-create', data };
  }
}
