/** Nối SCR-57/58 với tuyến đọc/ghi có sẵn qua `@pinehill/api-client` (không thêm endpoint). */
import { createBookingApi, createGuestApi } from '@pinehill/api-client';
import {
  checkInRequestSchema,
  checkInResponseSchema,
  listResponseSchema,
  roomSummarySchema,
  type CheckInResponse,
  type GuestSummary,
} from '@pinehill/contracts';
import type { Session } from '../session';
import type { CheckInBody } from './model';
import type { ArrivalsPorts } from './reader';

export function arrivalsPorts(session: Session): ArrivalsPorts {
  return {
    now: () => new Date(),
    bookings: async (query) => (await createBookingApi(session.resourceClient()).list(query)).data,
    rooms: async (query) =>
      (
        await session.resourceClient().request({
          method: 'GET',
          path: '/rooms',
          query,
          decoder: listResponseSchema(roomSummarySchema),
        })
      ).data,
  };
}

/** Lệnh ghi dùng client ghim token/phiên hiện tại và đúng một lần gửi (không tự refresh/gửi lại). */
export async function sendCheckIn(
  session: Session,
  body: CheckInBody,
  idempotencyKey: string,
): Promise<CheckInResponse> {
  const response = await session.resourceClient().request({
    method: 'POST',
    path: '/front-office/check-in',
    body: checkInRequestSchema.parse(body),
    idempotencyKey,
    decoder: checkInResponseSchema,
  });
  return response.data;
}

/** Hồ sơ khách theo id (HB-208) cho tên trên thẻ SCR-57; client ghim phiên hiện tại, một lần gửi. */
export function guestPort(session: Session): (guestId: string) => Promise<GuestSummary> {
  return async (guestId) => (await createGuestApi(session.resourceClient()).get(guestId)).data;
}
