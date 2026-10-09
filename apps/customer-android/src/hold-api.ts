/**
 * Nối lớp thuần `src/hold.ts` với client đã có access token của phiên khách (HB-087).
 * Không nhận/trả token ra ngoài — chỉ dùng `Session.apiClient()`.
 */
import type { ApiClient } from '@pinehill/api-client';
import { createBookingApi } from '@pinehill/api-client';
import { holdCreateRequestSchema, holdSchema } from '@pinehill/contracts';
import type { Hold, HoldCreateRequest } from '@pinehill/contracts';
import type { HoldApi } from './hold';

export function holdApiFrom(client: ApiClient): HoldApi {
  const booking = createBookingApi(client);
  return {
    hold: async (request: HoldCreateRequest): Promise<Hold> => {
      const response = await client.request({
        method: 'POST',
        path: '/holds',
        body: holdCreateRequestSchema.parse(request),
        decoder: holdSchema,
      });
      return response.data;
    },
    book: async (request) => (await booking.create(request)).data,
  };
}
