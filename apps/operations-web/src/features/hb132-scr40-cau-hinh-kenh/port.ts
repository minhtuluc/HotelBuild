/**
 * Cổng I/O của SCR-40: đọc danh mục/hạn mức F3 và gửi lệnh F6 qua BFF `/api/session/sys/**`.
 * Lệnh ghi đi thẳng `client.request` vì `createChannelApi` (HB-120) chưa cho truyền `Idempotency-Key`
 * của lần gửi trước và bắt `If-Match` cả khi tạo mới — hai điều api.md §1.6 cần để retry đúng key.
 */
import type { ApiClient } from '@pinehill/api-client';
import {
  allotmentQuerySchema,
  allotmentRowSchema,
  channelMappingsViewSchema,
  channelSummarySchema,
  listResponseSchema,
  propertySummarySchema,
  roomTypeSummarySchema,
  salesClosureViewSchema,
  userMeSchema,
  type AllotmentRow,
  type ChannelMappingsView,
  type ChannelSummary,
  type PropertySummary,
  type RoomTypeSummary,
  type SalesClosureView,
  type UserMe,
} from '@pinehill/contracts';
import { completeCatalogue } from '../../app/(ops)/admin-commands/catalogue';
import type { GridRange } from '../../lib/inventory-grid';
import type { Intent } from './model';

export interface Actor {
  userId: string;
  role: UserMe['role'];
  propertyScope: readonly string[];
}

export interface Selection {
  propertyId: string | null;
  channelId: string | null;
  roomTypeId: string | null;
  range: GridRange;
}

export interface ConfigData {
  properties: PropertySummary[];
  channels: ChannelSummary[];
  roomTypes: RoomTypeSummary[];
  selection: Selection;
  rows: readonly AllotmentRow[];
}

export type MappingIntent = Extract<Intent, { kind: 'mapping' }>;
export type ClosureIntent = Extract<Intent, { kind: 'closure' }>;

export interface ConfigPorts {
  actor(signal: AbortSignal): Promise<Actor>;
  load(selection: Selection, signal: AbortSignal): Promise<ConfigData>;
  putMapping(
    intent: MappingIntent,
    signal: AbortSignal,
  ): Promise<{ view: ChannelMappingsView; etag: string | undefined }>;
  closeSales(intent: ClosureIntent, signal: AbortSignal): Promise<SalesClosureView>;
}

/** Chọn mục đang chọn nếu còn trong danh sách do máy chủ trả, ngược lại mục đầu; rỗng → `null`. */
function pick<T extends { id: string }>(rows: readonly T[], wanted: string | null): string | null {
  return rows.find((row) => row.id === wanted)?.id ?? rows[0]?.id ?? null;
}

export function normalize(
  catalogue: Pick<ConfigData, 'properties' | 'channels' | 'roomTypes'>,
  wanted: Selection,
): { selection: Selection; roomTypes: RoomTypeSummary[] } {
  const propertyId = pick(catalogue.properties, wanted.propertyId);
  const roomTypes = catalogue.roomTypes.filter((type) => type.propertyId === propertyId);
  return {
    roomTypes,
    selection: {
      propertyId,
      channelId: pick(catalogue.channels, wanted.channelId),
      roomTypeId: pick(roomTypes, wanted.roomTypeId),
      range: wanted.range,
    },
  };
}

export function createPorts(client: ApiClient): ConfigPorts {
  return {
    actor: async (signal) => {
      const me = (
        await client.request({ method: 'GET', path: '/auth/me', decoder: userMeSchema, signal })
      ).data;
      return { userId: me.userId, role: me.role, propertyScope: me.propertyScope };
    },
    load: async (wanted, signal) => {
      const properties = await completeCatalogue(
        client,
        '/properties',
        listResponseSchema(propertySummarySchema),
        signal,
      );
      const allTypes = await completeCatalogue(
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
      const { selection, roomTypes } = normalize(
        { properties, channels, roomTypes: allTypes },
        wanted,
      );
      if (selection.channelId === null || selection.roomTypeId === null)
        return { properties, channels, roomTypes, selection, rows: [] };
      const query = allotmentQuerySchema.parse({
        channelId: selection.channelId,
        roomTypeId: selection.roomTypeId,
        ...selection.range,
      });
      const rows = (
        await client.request({
          method: 'GET',
          path: '/channel-allotments',
          query,
          decoder: listResponseSchema(allotmentRowSchema),
          signal,
          maxAttempts: 1,
        })
      ).data.data;
      return { properties, channels, roomTypes, selection, rows };
    },
    putMapping: async (intent, signal) => {
      const response = await client.request({
        method: 'PUT',
        path: `/channels/${encodeURIComponent(intent.channelId)}/mappings`,
        body: intent.body,
        idempotencyKey: intent.key,
        ...(intent.ifMatch === undefined ? {} : { ifMatch: intent.ifMatch }),
        decoder: channelMappingsViewSchema,
        signal,
      });
      return { view: response.data, etag: response.etag };
    },
    closeSales: async (intent, signal) =>
      (
        await client.request({
          method: 'POST',
          path: `/channels/${encodeURIComponent(intent.channelId)}/sales-closure`,
          body: intent.body,
          idempotencyKey: intent.key,
          decoder: salesClosureViewSchema,
          signal,
        })
      ).data,
  };
}
