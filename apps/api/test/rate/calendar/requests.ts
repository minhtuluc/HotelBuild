/** Helper request dùng chung cho các spec HB-054 (đọc/ghi lịch giá và mùa). */
import { randomUUID } from 'node:crypto';
import { http, rows, typeId } from './fixture.js';

export const calendarRequest = (
  token: string,
  roomTypeId: string = typeId,
  query: Record<string, unknown> = {},
) =>
  http()
    .get(`/api/v1/room-types/${roomTypeId}/rate-calendar`)
    .set('Authorization', `Bearer ${token}`)
    .query(query);

export const overrideRequest = (
  token: string,
  body: object,
  options: { roomTypeId?: string; key?: string | null } = {},
) => {
  const request = http()
    .put(`/api/v1/room-types/${options.roomTypeId ?? typeId}/rate-calendar`)
    .set('Authorization', `Bearer ${token}`);
  if (options.key !== null) request.set('Idempotency-Key', options.key ?? randomUUID());
  return request.send(body);
};

export const seasonListRequest = (token: string, query: Record<string, unknown> = {}) =>
  http().get('/api/v1/seasons').set('Authorization', `Bearer ${token}`).query(query);

export const createSeasonRequest = (
  token: string,
  body: object,
  key: string | null = randomUUID(),
) => {
  const request = http().post('/api/v1/seasons').set('Authorization', `Bearer ${token}`);
  if (key !== null) request.set('Idempotency-Key', key);
  return request.send(body);
};

export const overrideAuditCount = async () =>
  Number(
    (
      await rows(
        "SELECT count(*)::int AS n FROM audit_logs WHERE action='RATE_CALENDAR_OVERRIDDEN'",
      )
    )[0]!.n,
  );
