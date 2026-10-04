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
import type {
  Availability,
  ListPage,
  Quote,
  QuoteRequest,
  RatePlanPublic,
} from '@pinehill/contracts';

export interface PublicJourneyApi {
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
    availability: (query) => inventory.availability(query),
    quote: (input) => quote.quote(input),
    listRatePlans: (query) => rate.listRatePlans(query),
  };
}
