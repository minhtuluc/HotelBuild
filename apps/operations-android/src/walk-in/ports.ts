/** Nối SCR-65 với tuyến có sẵn: `/room-types`, `POST /walk-in`, `/auth/pin/verify`, `POST /payments`. */
import { createAuthApi } from '@pinehill/api-client';
import {
  listResponseSchema,
  paymentCreateRequestSchema,
  paymentSchema,
  roomTypeSummarySchema,
  walkInRequestSchema,
  walkInResultSchema,
  type RoomTypeSummary,
} from '@pinehill/contracts';
import type { Session } from '../session';
import type { WalkInPorts } from './flow';

const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

export type WalkInApiPorts = Pick<WalkInPorts, 'roomTypes' | 'createBooking' | 'verifyPin' | 'pay'>;

/**
 * Mỗi lệnh dùng client ghim token/phiên hiện tại và đúng một lần gửi (không tự refresh/gửi lại). `pinToken` do
 * luồng giữ và chèn vào thân lệnh thu (không đi qua `Session`), nên không dùng `pinProtected`.
 */
export function walkInApiPorts(session: Session): WalkInApiPorts {
  return {
    roomTypes: async (propertyId) => {
      const rows: RoomTypeSummary[] = [];
      let cursor: string | undefined;
      for (let index = 0; index < MAX_PAGES; index += 1) {
        const page = (
          await session.resourceClient().request({
            method: 'GET',
            path: '/room-types',
            query: { propertyId, limit: PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
            decoder: listResponseSchema(roomTypeSummarySchema),
          })
        ).data;
        rows.push(...page.data);
        cursor = page.meta.hasMore ? (page.meta.nextCursor ?? undefined) : undefined;
        if (cursor === undefined) return rows;
      }
      return rows;
    },
    createBooking: async (request, idempotencyKey) =>
      (
        await session.resourceClient().request({
          method: 'POST',
          path: '/walk-in',
          body: walkInRequestSchema.parse(request),
          idempotencyKey,
          decoder: walkInResultSchema,
        })
      ).data,
    verifyPin: async (pin, bookingId) =>
      (await createAuthApi(session.resourceClient()).pinVerify(pin, bookingId)).data,
    pay: async (body, idempotencyKey) =>
      (
        await session.resourceClient().request({
          method: 'POST',
          path: '/payments',
          body: paymentCreateRequestSchema.parse(body),
          idempotencyKey,
          decoder: paymentSchema,
        })
      ).data,
  };
}
