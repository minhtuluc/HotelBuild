import { ApiClient, ApiError } from '@pinehill/api-client';
import {
  allotmentQuerySchema,
  allotmentPutRequestSchema,
  allotmentRowSchema,
  channelSummarySchema,
  propertySummarySchema,
  roomTypeSummarySchema,
  listResponseSchema,
  type RoomTypeSummary,
  type ChannelSummary,
  type ListPage,
  type AllotmentRow,
} from '@pinehill/contracts';
import { defaultRange, gridDates, type GridRange } from '../../../lib/inventory-grid';
import type { AdminCommand } from './intent';
import type { AdminData, AdminReceipt } from './model';
import { completeCatalogue } from './catalogue';
import { validAllotmentTag } from './allotment-intent';
export interface AllotmentSelection {
  propertyId?: string;
  channelId?: string;
  roomTypeId?: string;
  range: GridRange;
}
export async function readAllotments(
  client: ApiClient,
  signal: AbortSignal,
  selection: AllotmentSelection = { range: defaultRange(new Date()) },
  intent?: AdminCommand,
): Promise<AdminData> {
  const properties = await completeCatalogue(
    client,
    '/properties',
    listResponseSchema(propertySummarySchema),
    signal,
  );
  const roomTypes = await completeCatalogue(
    client,
    '/room-types',
    listResponseSchema(roomTypeSummarySchema),
    signal,
  );
  const channels = await completeCatalogue(
    client,
    '/channels',
    listResponseSchema(channelSummarySchema),
    signal,
  );
  const requested =
    intent?.kind === 'allotment-put'
      ? {
          channelId: intent.body.channelId,
          roomTypeId: intent.body.roomTypeId,
          range: intent.range,
        }
      : selection;
  if (!properties.length || !roomTypes.length || !channels.length)
    return { properties, roomTypes, channels };
  const { type, channel } = selectPair({ properties, roomTypes, channels }, requested);
  const query = allotmentQuerySchema.parse({
    channelId: channel.id,
    roomTypeId: type.id,
    ...requested.range,
  });
  const dates = new Set(gridDates(query.from, query.to));
  if (!dates.size) throw new ApiError({ kind: 'protocol', message: 'Invalid allotment range' });
  const result = await client.request({
    method: 'GET',
    path: '/channel-allotments',
    query,
    decoder: listResponseSchema(allotmentRowSchema),
    signal,
    maxAttempts: 1,
  });
  if (!validAllotmentTag(result.etag))
    throw new ApiError({ kind: 'protocol', message: 'Invalid allotment tag' });
  validateRows(result.data, dates);
  return {
    properties,
    roomTypes,
    channels,
    allotment: {
      propertyId: type.propertyId,
      channelId: channel.id,
      roomTypeId: type.id,
      range: requested.range,
      rows: result.data.data,
      tag: result.etag,
    },
  };
}
function selectPair(
  data: AdminData,
  selection: AllotmentSelection,
): { type: RoomTypeSummary; channel: ChannelSummary } {
  const selected = selectedType(data.roomTypes, selection.roomTypeId);
  const propertyId = selection.propertyId ?? selected?.propertyId ?? data.properties[0]?.id;
  const type = selected ?? data.roomTypes.find((type) => type.propertyId === propertyId);
  if (
    !type ||
    type.propertyId !== propertyId ||
    !data.properties.some((row) => row.id === propertyId)
  )
    throw selectionError();
  return { type, channel: selectChannel(data.channels ?? [], selection.channelId) };
}
function selectedType(
  types: readonly RoomTypeSummary[],
  id: string | undefined,
): RoomTypeSummary | undefined {
  if (!id) return undefined;
  const type = types.find((row) => row.id === id);
  if (!type) throw selectionError();
  return type;
}
function selectChannel(
  channels: readonly ChannelSummary[],
  id: string | undefined,
): ChannelSummary {
  const channel = id ? channels.find((row) => row.id === id) : channels[0];
  if (!channel) throw selectionError();
  return channel;
}
function selectionError() {
  return new ApiError({ kind: 'http', status: 403, message: 'Selection no longer available' });
}
function validateRows(page: ListPage<AllotmentRow>, dates: Set<string>): void {
  if (
    page.meta.hasMore ||
    page.meta.total !== page.data.length ||
    new Set(page.data.map((row) => row.date)).size !== page.data.length ||
    page.data.some(
      (row) =>
        !dates.has(row.date) ||
        !Number.isSafeInteger(row.allotment) ||
        !Number.isSafeInteger(row.used),
    )
  )
    throw new ApiError({ kind: 'protocol', message: 'Invalid allotment projection' });
}
export async function writeAllotments(
  client: ApiClient,
  command: Extract<AdminCommand, { kind: 'allotment-put' }>,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<AdminReceipt> {
  const result = await client.requestVoid({
    method: 'PUT',
    path: '/channel-allotments',
    body: allotmentPutRequestSchema.parse(command.body),
    ifMatch: command.tag,
    idempotencyKey,
    headers: { 'x-session-request': '1' },
    signal,
    maxAttempts: 1,
  });
  if (
    result.status !== 204 ||
    !validAllotmentTag(result.etag) ||
    BigInt(result.etag.slice(1, -1)) <= BigInt(command.tag.slice(1, -1))
  )
    throw new ApiError({ kind: 'protocol', message: 'Invalid allotment acknowledgment' });
  return {
    kind: 'allotment-put',
    channelId: command.body.channelId,
    roomTypeId: command.body.roomTypeId,
    tag: result.etag,
  };
}
