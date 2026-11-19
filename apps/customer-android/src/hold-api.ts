/**
 * Nối lớp thuần `src/hold.ts` với client đã có access token của phiên khách (HB-087).
 * Không nhận/trả token ra ngoài — chỉ dùng `Session.apiClient()`.
 */
import type { ApiClient } from '@pinehill/api-client';
import { createBookingApi } from '@pinehill/api-client';
import { quoteRequestSchema, quoteSchema } from '@pinehill/contracts';
import type { HoldApi } from './hold';

export function holdApiFrom(client: ApiClient): HoldApi {
  const booking = createBookingApi(client);
  return {
    quote: async (request) => {
      const response = await client.request({
        method: 'POST',
        path: '/quotes',
        body: quoteRequestSchema.parse(request),
        decoder: quoteSchema,
      });
      return response.data;
    },
    book: async (request) => (await booking.create(request)).data,
  };
}
