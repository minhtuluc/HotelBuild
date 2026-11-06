/**
 * Cổng I/O của SCR-41: đọc kênh/trạng thái/outbox/tác vụ và gửi lệnh đồng bộ + đẩy lại qua BFF
 * `/api/session/sys/**`. Lệnh ghi đi thẳng `client.request` để truyền lại `Idempotency-Key` của lần
 * trước (`createChannelApi` sinh khoá mới mỗi lần gọi, trái api.md §1.6).
 */
import type { ApiClient } from '@pinehill/api-client';
import {
  channelSummarySchema,
  channelSyncRequestSchema,
  channelSyncStatusViewSchema,
  listResponseSchema,
  operationRefSchema,
  operationStatusViewSchema,
  outboxDeliverySchema,
  userMeSchema,
  type ChannelSummary,
  type ChannelSyncStatusView,
  type ListPage,
  type OperationRef,
  type OperationStatusView,
  type OutboxDelivery,
  type UserMe,
} from '@pinehill/contracts';
import { completeCatalogue } from '../../app/(ops)/admin-commands/catalogue';
import type { Intent } from './model';

export interface Actor {
  userId: string;
  role: UserMe['role'];
  propertyScope: readonly string[];
}

export type SyncIntent = Extract<Intent, { kind: 'sync' }>;
export type RetryIntent = Extract<Intent, { kind: 'retry' }>;

export interface DeliveryQuery {
  cursor?: string;
  status?: OutboxDelivery['status'];
}

export interface SyncPorts {
  actor(signal: AbortSignal): Promise<Actor>;
  channels(signal: AbortSignal): Promise<ChannelSummary[]>;
  status(channelId: string, signal: AbortSignal): Promise<ChannelSyncStatusView>;
  deliveries(
    channelId: string,
    query: DeliveryQuery,
    signal: AbortSignal,
  ): Promise<ListPage<OutboxDelivery>>;
  sync(intent: SyncIntent, signal: AbortSignal): Promise<OperationRef>;
  retry(intent: RetryIntent, signal: AbortSignal): Promise<OperationRef>;
  operation(operationId: string, signal: AbortSignal): Promise<OperationStatusView>;
}

const enc = encodeURIComponent;
const PAGE = 20;

export function createPorts(client: ApiClient): SyncPorts {
  return {
    actor: async (signal) => {
      const me = (
        await client.request({ method: 'GET', path: '/auth/me', decoder: userMeSchema, signal })
      ).data;
      return { userId: me.userId, role: me.role, propertyScope: me.propertyScope };
    },
    channels: (signal) =>
      completeCatalogue(client, '/channels', listResponseSchema(channelSummarySchema), signal),
    status: async (channelId, signal) =>
      (
        await client.request({
          method: 'GET',
          path: `/channels/${enc(channelId)}/sync-status`,
          decoder: channelSyncStatusViewSchema,
          signal,
          maxAttempts: 1,
        })
      ).data,
    deliveries: async (channelId, query, signal) =>
      (
        await client.request({
          method: 'GET',
          path: `/channels/${enc(channelId)}/outbox-deliveries`,
          query: { limit: PAGE, ...query },
          decoder: listResponseSchema(outboxDeliverySchema),
          signal,
          maxAttempts: 1,
        })
      ).data,
    sync: async (intent, signal) =>
      (
        await client.request({
          method: 'POST',
          path: `/channels/${enc(intent.channelId)}/sync`,
          body: channelSyncRequestSchema.parse(intent.body),
          idempotencyKey: intent.key,
          decoder: operationRefSchema,
          signal,
        })
      ).data,
    retry: async (intent, signal) =>
      (
        await client.request({
          method: 'POST',
          path: `/channels/${enc(intent.channelId)}/outbox-deliveries/${enc(intent.deliveryId)}/retry`,
          idempotencyKey: intent.key,
          decoder: operationRefSchema,
          signal,
        })
      ).data,
    operation: async (operationId, signal) =>
      (
        await client.request({
          method: 'GET',
          path: `/operations/${enc(operationId)}`,
          decoder: operationStatusViewSchema,
          signal,
          maxAttempts: 1,
        })
      ).data,
  };
}
