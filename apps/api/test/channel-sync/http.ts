/**
 * HTTP helper dùng chung cho test khoá HB-131 — giữ tệp spec trong hạn `max-lines` và để mọi request
 * luôn mang đúng header (Authorization, Idempotency-Key, If-Match) như client thật.
 */
import { randomUUID } from 'node:crypto';
import { auth, http, rows, seed } from './fixture.js';

export const otaChannel = (): string => seed.channels['OTA_BOOKING']!;
export const agodaChannel = (): string => seed.channels['OTA_AGODA']!;

/** Version hiện hành của kênh dùng làm `If-Match` (ETag dạng `"<version>"`). */
export async function currentEtag(): Promise<string> {
  const version = Number(
    (await rows('SELECT version FROM channels WHERE id=$1', [otaChannel()]))[0]!.version,
  );
  return `"${version}"`;
}

export function syncRequest(
  token: string,
  body: object,
  key = randomUUID(),
  channel = otaChannel(),
) {
  return http()
    .post(`/api/v1/channels/${channel}/sync`)
    .set(auth(token))
    .set('Idempotency-Key', key)
    .send(body);
}

export function mappingsRequest(token: string, body: object, etag: string | null = null) {
  const request = http()
    .put(`/api/v1/channels/${otaChannel()}/mappings`)
    .set(auth(token))
    .set('Idempotency-Key', randomUUID());
  if (etag !== null) request.set('If-Match', etag);
  return request.send(body);
}

export function closureRequest(token: string, body: object, key = randomUUID()) {
  return http()
    .post(`/api/v1/channels/${otaChannel()}/sales-closure`)
    .set(auth(token))
    .set('Idempotency-Key', key)
    .send(body);
}

/** Đọc projection con của một kênh (`ota-bookings`, `sync-status`, `outbox-deliveries`). */
export function readChannel(token: string, path: string, channel = otaChannel()) {
  return http().get(`/api/v1/channels/${channel}/${path}`).set(auth(token));
}

export const mapping = (overrides: Record<string, unknown> = {}) => ({
  roomTypeId: seed.typeId,
  providerRoomTypeCode: 'STD-OTA-BOOKING',
  ...overrides,
});
