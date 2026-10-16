/** Helper request dùng chung cho các spec HB-074 (`POST /quotes` và đường tiêu thụ quote). */
import { randomUUID } from 'node:crypto';
import { http, dlxTypeId, propertyId, stay } from './fixture.js';

/** Thân lệnh báo giá mặc định: DLX, `WEB`, `FLEX7`, 3 đêm 30/04–03/05/2026 (số vàng `dong-gia.md` §5 ca 2). */
export const quoteBody = (overrides: object = {}): Record<string, unknown> => ({
  propertyId,
  roomTypeId: dlxTypeId,
  channelCode: 'WEB',
  ratePlanCode: 'FLEX7',
  checkIn: stay.checkIn,
  checkOut: stay.checkOut,
  adults: 2,
  children: 0,
  roomCount: 1,
  ...overrides,
});

export const quoteRequest = (
  body: object,
  options: { token?: string; key?: string | null } = {},
) => {
  const request = http().post('/api/v1/quotes');
  if (options.token !== undefined) request.set('Authorization', `Bearer ${options.token}`);
  if (options.key !== null) request.set('Idempotency-Key', options.key ?? randomUUID());
  return request.send(body);
};

export const multiChannelRequest = (token: string, body: object) =>
  http().post('/api/v1/quotes/multi-channel').set('Authorization', `Bearer ${token}`).send(body);
