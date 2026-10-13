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
  const catalogues = { properties, roomTypes, channels };
  const chosen = normalizeSelection(catalogues, requested);
  const pair = selectPair(catalogues, chosen);
  if (!pair) return { ...catalogues, allotmentSelection: chosen };
  const { type, channel } = pair;
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
    allotmentSelection: {
      ...chosen,
      propertyId: type.propertyId,
      channelId: channel.id,
      roomTypeId: type.id,
    },
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
): { type: RoomTypeSummary; channel: ChannelSummary } | undefined {
  const type = pairType(data, selection);
  if (!type || !data.properties.some((row) => row.id === type.propertyId)) return undefined;
  const channel = selectChannel(data.channels ?? [], selection.channelId);
  return channel ? { type, channel } : undefined;
}
function pairType(data: AdminData, selection: AllotmentSelection): RoomTypeSummary | undefined {
  const type = selection.roomTypeId
    ? selectedType(data.roomTypes, selection.roomTypeId)
    : data.roomTypes.find((row) => row.propertyId === selection.propertyId);
  return type?.propertyId === selection.propertyId ? type : undefined;
}
function selectedType(
  types: readonly RoomTypeSummary[],
  id: string | undefined,
): RoomTypeSummary | undefined {
  if (!id) return undefined;
  const type = types.find((row) => row.id === id);
  if (!type) return undefined;
  return type;
}
function selectChannel(
  channels: readonly ChannelSummary[],
  id: string | undefined,
): ChannelSummary | undefined {
  const channel = id ? channels.find((row) => row.id === id) : channels[0];
  if (!channel) return undefined;
  return channel;
}
function normalizeSelection(data: AdminData, requested: AllotmentSelection): AllotmentSelection {
  const propertyId = defaultProperty(data, requested);
  const channelId = requested.channelId ?? data.channels?.[0]?.id;
  return {
    range: requested.range,
    ...(propertyId ? { propertyId } : {}),
    ...(channelId ? { channelId } : {}),
    ...(requested.roomTypeId ? { roomTypeId: requested.roomTypeId } : {}),
  };
}
function defaultProperty(data: AdminData, requested: AllotmentSelection): string | undefined {
  if (requested.propertyId) return requested.propertyId;
  const type = selectedType(data.roomTypes, requested.roomTypeId);
  if (type) return type.propertyId;
  const available =
    data.properties.find((property) =>
      data.roomTypes.some((type) => type.propertyId === property.id),
    ) ?? data.properties[0];
  return available?.id;
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
