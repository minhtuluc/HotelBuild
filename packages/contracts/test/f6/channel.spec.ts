/** HB-120 AC1/AC8/AC11/AC14: hợp đồng CHAN — bốn tuyến lõi, inbox simulator và đường vận hành. */
import { describe, expect, it } from 'vitest';
import {
  channelMappingPutRequestSchema,
  channelSyncRequestSchema,
  channelSyncStatusViewSchema,
  otaBookingFlagRequestSchema,
  otaBookingSchema,
  otaInboxAckSchema,
  otaWebhookEventSchema,
  otaWebhookHeadersSchema,
  otaWebhookSignatureSchema,
  outboxDeliverySchema,
  salesClosureRequestSchema,
  salesClosureRowSchema,
  salesClosureViewSchema,
} from '../../src/channel.js';
import { listResponseSchema } from '../../src/common.js';
import {
  asObject,
  documentJson,
  DELIVERY,
  MAPPING,
  OTA_BOOKING,
  operationOf,
  parameterNames,
  responseCodes,
  SALES_CLOSURE,
  SYNC_STATUS,
  WEBHOOK_EVENT,
} from './fixtures.js';

/** Header phản hồi khai cho một mã trạng thái. */
function responseHeader(
  op: Record<string, unknown> | undefined,
  code: string,
  name: string,
): boolean {
  const response = asObject(asObject(op?.responses)?.[code]);
  const headers = asObject(response?.headers);
  return headers !== undefined && name in headers;
}

describe('F6 CHAN', () => {
  it('channel-routes', () => {
    const doc = documentJson();
    const routes = [
      ['post', '/api/v1/channels/{channelId}/sync', '202'],
      ['put', '/api/v1/channels/{channelId}/mappings', '200'],
      ['post', '/api/v1/channels/{channelId}/sales-closure', '200'],
      ['get', '/api/v1/channels/{channelId}/ota-bookings', '200'],
    ] as const;
    for (const [method, path, code] of routes) {
      const op = operationOf(doc, path, method);
      expect(op, `${method} ${path}`).toBeDefined();
      expect(responseCodes(op)).toContain(code);
    }
    // Tác vụ sync trả `{operationId,status,statusUrl}` + Location, dùng lại route đọc operation.
    const sync = operationOf(doc, '/api/v1/channels/{channelId}/sync', 'post');
    expect(responseHeader(sync, '202', 'Location')).toBe(true);
    expect(documentJson().paths).toHaveProperty(['/api/v1/operations/{operationId}']);
    // `GET /channels` đã phát hành ở F3 — F6 tái sử dụng, không tạo DTO khác ngữ nghĩa.
    expect(operationOf(doc, '/api/v1/channels', 'get')?.operationId).toBe('channelsList');
    expect(operationOf(doc, '/api/v1/channels/{channelId}', 'get')?.operationId).toBe(
      'channelsGet',
    );
    expect(
      channelSyncRequestSchema.parse({ scope: 'RANGE', from: '2026-12-24', to: '2026-12-25' }),
    ).toEqual({
      scope: 'RANGE',
      from: '2026-12-24',
      to: '2026-12-25',
    });
    expect(channelSyncRequestSchema.safeParse({ scope: 'RANGE', from: '2026-12-24' }).success).toBe(
      false,
    );
    expect(
      channelSyncRequestSchema.safeParse({ scope: 'FULL', from: '2026-12-24', to: '2026-12-25' })
        .success,
    ).toBe(false);
    // Request ghi dùng strictObject: trường lạ bị từ chối (api.md §6.4).
    expect(
      channelMappingPutRequestSchema.safeParse({ ...MAPPING, credentials: 'secret' }).success,
    ).toBe(false);
  });

  it('ota-inbox-ack-contract', () => {
    expect(otaWebhookEventSchema.parse(WEBHOOK_EVENT).eventType).toBe('booking.created');
    expect(
      otaWebhookEventSchema.safeParse({ ...WEBHOOK_EVENT, eventType: 'booking.deleted' }).success,
    ).toBe(false);
    expect(otaWebhookSignatureSchema.safeParse(`t=1730000000,v1=${'a'.repeat(64)}`).success).toBe(
      true,
    );
    expect(otaWebhookSignatureSchema.safeParse('t=1730000000,v1=short').success).toBe(false);
    const headers = {
      'x-pinehill-signature': `t=1730000000,v1=${'a'.repeat(64)}`,
      'x-pinehill-key-id': 'ota-key-1',
      'x-channel-event-id': 'evt-1',
    };
    expect(otaWebhookHeadersSchema.parse(headers)['x-channel-event-id']).toBe('evt-1');
    expect(
      otaWebhookHeadersSchema.safeParse({ ...headers, 'x-channel-event-id': undefined }).success,
    ).toBe(false);
    expect(otaInboxAckSchema.parse({ duplicate: false, eventId: 'evt-1' }).duplicate).toBe(false);
    expect(otaInboxAckSchema.parse({ duplicate: true, eventId: 'evt-1' }).duplicate).toBe(true);

    const op = operationOf(documentJson(), '/api/v1/integrations/ota/{channel}/bookings', 'post');
    expect(responseCodes(op)).toEqual(expect.arrayContaining(['202', '200', '400', '401', '409']));
    expect(parameterNames(op)).toEqual(
      expect.arrayContaining([
        'channel',
        'X-Pinehill-Signature',
        'X-Pinehill-Key-Id',
        'X-Channel-Event-Id',
      ]),
    );
    expect(String(op?.summary)).toContain('KHÔNG phải API thật');
    // Không mô tả simulator là API thật của đối tác: nhãn phải nói rõ đây là simulator Pine Hill.
    expect(String(op?.summary)).toContain('Simulator Pine Hill');
    expect(String(op?.description)).toContain('Inbox');
  });

  it('operations-read-retry-and-duplicate-review', () => {
    const syncStatus = channelSyncStatusViewSchema.parse(SYNC_STATUS);
    expect(syncStatus.consecutiveFailures).toBe(0);
    expect(syncStatus.history.map((entry) => entry.outcome)).toEqual(['FAILURE', 'SUCCESS']);
    expect(outboxDeliverySchema.parse(DELIVERY).consumerKey).toBe('ota:booking');
    expect(
      listResponseSchema(outboxDeliverySchema).parse({
        data: [DELIVERY],
        meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 },
      }).data,
    ).toHaveLength(1);
    expect(otaBookingSchema.parse(OTA_BOOKING).flagged).toBe(true);
    expect(
      otaBookingFlagRequestSchema.parse({ flagged: true, reason: 'Nghi trùng mã OTA' }).flagged,
    ).toBe(true);
    expect(
      otaBookingFlagRequestSchema.safeParse({ flagged: true, reason: 'x', cancelBooking: true })
        .success,
    ).toBe(false);
    expect(otaBookingFlagRequestSchema.safeParse({ flagged: false }).success).toBe(false);

    const doc = documentJson();
    const retryPath = '/api/v1/channels/{channelId}/outbox-deliveries/{deliveryId}/retry';
    const retry = operationOf(doc, retryPath, 'post');
    expect(responseCodes(retry)).toContain('202');
    expect(responseHeader(retry, '202', 'Location')).toBe(true);
    // Không có body: client không thể đổi event/consumer key khi retry.
    expect(retry?.requestBody).toBeUndefined();
    const flag = operationOf(
      doc,
      '/api/v1/channels/{channelId}/ota-bookings/{bookingId}/duplicate-flag',
      'post',
    );
    expect(parameterNames(flag)).toEqual(expect.arrayContaining(['If-Match', 'Idempotency-Key']));
    expect(responseHeader(flag, '200', 'ETag')).toBe(true);
  });

  it('closure_provenance_and_sync_recovery', () => {
    const body = { roomTypeId: 'rt1', from: '2026-12-24', to: '2026-12-26', reason: 'Hết phòng' };
    // `closed` mặc định true để giữ hành vi đã phát hành.
    expect(salesClosureRequestSchema.parse(body).closed).toBe(true);
    expect(salesClosureRequestSchema.parse({ ...body, closed: false }).closed).toBe(false);
    expect(salesClosureRequestSchema.safeParse({ ...body, reason: '' }).success).toBe(false);
    expect(salesClosureRequestSchema.safeParse({ ...body, to: '2026-12-20' }).success).toBe(false);

    const view = salesClosureViewSchema.parse(SALES_CLOSURE);
    const row = view.rows[0];
    expect(row?.closed).toBe(true);
    expect(row?.manual).toEqual({ closed: false, reason: null, closedAt: null, reopenedAt: null });
    expect(String(row?.automatic.reason)).toContain('BR-CHAN-05');
    // Mở thủ công chỉ gỡ manual flag; auto closure vẫn giữ đóng.
    const reopened = salesClosureRowSchema.parse({
      ...row,
      closed: true,
      manual: { closed: false, reason: null, closedAt: null, reopenedAt: '2026-12-02T00:00:00Z' },
    });
    expect(reopened.closed).toBe(true);

    // Success xác minh phục hồi OK/counter 0 nhưng lịch sử lỗi còn nguyên.
    const recovered = channelSyncStatusViewSchema.parse({
      ...SYNC_STATUS,
      consecutiveFailures: 0,
      syncStatus: 'OK',
    });
    expect(recovered.syncStatus).toBe('OK');
    expect(recovered.history).toHaveLength(2);
    expect(
      channelSyncStatusViewSchema.safeParse({ ...SYNC_STATUS, history: undefined }).success,
    ).toBe(false);
    expect(
      operationOf(documentJson(), '/api/v1/channels/{channelId}/sync-status', 'get'),
    ).toBeDefined();
  });
});
