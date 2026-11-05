/**
 * Cổng I/O của SCR-42: đọc kênh/danh sách booking OTA và gửi lệnh gắn cờ qua BFF `/api/session/sys/**`.
 * Lệnh ghi đi thẳng `client.request` để truyền lại `Idempotency-Key` của lần trước (`createChannelApi`
 * sinh khoá mới mỗi lần gọi, trái api.md §1.6).
 */
import type { ApiClient } from '@pinehill/api-client';
import {
  channelSummarySchema,
  listResponseSchema,
  otaBookingFlagRequestSchema,
  otaBookingSchema,
  userMeSchema,
  type ChannelSummary,
  type ListPage,
  type OtaBooking,
  type UserMe,
} from '@pinehill/contracts';
import { completeCatalogue } from '../../app/(ops)/admin-commands/catalogue';
import type { Filter, Intent } from './model';

export interface Actor {
  userId: string;
  role: UserMe['role'];
  propertyScope: readonly string[];
}

export interface OtaPorts {
  actor(signal: AbortSignal): Promise<Actor>;
  channels(signal: AbortSignal): Promise<ChannelSummary[]>;
  list(
    channelId: string,
    filter: Filter,
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<ListPage<OtaBooking>>;
  flag(intent: Intent, signal: AbortSignal): Promise<OtaBooking>;
}

const enc = encodeURIComponent;
const PAGE = 20;

/** Chỉ gửi bộ lọc có giá trị; không thêm tham số ngoài hợp đồng HB-120. */
export function listQuery(filter: Filter, cursor: string | undefined) {
  return {
    limit: PAGE,
    ...(cursor === undefined ? {} : { cursor }),
    ...(filter.status === null ? {} : { status: filter.status }),
    ...(filter.q.trim() === '' ? {} : { q: filter.q.trim() }),
    ...(filter.from === '' ? {} : { from: filter.from }),
    ...(filter.to === '' ? {} : { to: filter.to }),
  };
}

export function createPorts(client: ApiClient): OtaPorts {
  return {
    actor: async (signal) => {
      const me = (
        await client.request({ method: 'GET', path: '/auth/me', decoder: userMeSchema, signal })
      ).data;
      return { userId: me.userId, role: me.role, propertyScope: me.propertyScope };
    },
    channels: (signal) =>
      completeCatalogue(client, '/channels', listResponseSchema(channelSummarySchema), signal),
    list: async (channelId, filter, cursor, signal) =>
      (
        await client.request({
          method: 'GET',
          path: `/channels/${enc(channelId)}/ota-bookings`,
          query: listQuery(filter, cursor),
          decoder: listResponseSchema(otaBookingSchema),
          signal,
          maxAttempts: 1,
        })
      ).data,
    flag: async (intent, signal) =>
      (
        await client.request({
          method: 'POST',
          path: `/channels/${enc(intent.channelId)}/ota-bookings/${enc(intent.bookingId)}/duplicate-flag`,
          body: otaBookingFlagRequestSchema.parse(intent.body),
          idempotencyKey: intent.key,
          ifMatch: intent.ifMatch,
          decoder: otaBookingSchema,
          signal,
        })
      ).data,
  };
}
