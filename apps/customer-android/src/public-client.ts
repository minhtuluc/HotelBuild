/**
 * Client công khai cho journey khách (HB-084, ADR-018): gọi `availability`/`quotes`/`rate-plans`
 * **khi chưa đăng nhập** nên **không** gắn access token. Tìm phòng/báo giá/xem gói giá là nhóm công
 * khai theo api.md §6.3.
 */
import {
  createInventoryApi,
  createQuoteApi,
  createRateApi,
  type ApiClient,
  type ApiResponse,
} from '@pinehill/api-client';
import { listResponseSchema, propertyPublicSummarySchema } from '@pinehill/contracts';
import type {
  Availability,
  ListPage,
  PropertyPublicSummary,
  Quote,
  QuoteRequest,
  RatePlanPublic,
} from '@pinehill/contracts';

export interface PublicJourneyApi {
  /** HB-249: `GET /public/properties` — cơ sở để khách chọn khi tìm phòng (API tìm phòng cần id). */
  listProperties(): Promise<readonly PropertyPublicSummary[]>;
  availability(query: {
    propertyId: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    roomCount: number;
    roomTypeId?: string;
    channelCode?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ApiResponse<Availability>>;
  quote(input: QuoteRequest): Promise<ApiResponse<Quote>>;
  listRatePlans(query?: {
    propertyId?: string;
    checkIn?: string;
    checkOut?: string;
  }): Promise<ApiResponse<ListPage<RatePlanPublic>>>;
}

/** Gom bề mặt công khai của journey khách quanh một `ApiClient` không có token. */
export function createPublicJourneyApi(client: ApiClient): PublicJourneyApi {
  const inventory = createInventoryApi(client);
  const quote = createQuoteApi(client);
  const rate = createRateApi(client);
  return {
    listProperties: async () => {
      const page = await client.request({
        method: 'GET',
        path: '/public/properties',
        decoder: listResponseSchema(propertyPublicSummarySchema),
      });
      return page.data.data;
    },
    availability: (query) => inventory.availability(query),
    quote: (input) => quote.quote(input),
    listRatePlans: (query) => rate.listRatePlans(query),
  };
}
