/**
 * Lớp gọi API hành trình cho SCR-02/SCR-03 (customer web): dùng chung BFF `/api/session/journey`
 * của HB-079. Tuyến công khai nên không cần phiên; client vẫn đi qua BFF để giữ một đường vào API.
 */
import { createJourneyApiClient } from '@pinehill/web-session/client';
import {
  availabilitySchema,
  availabilityQuerySchema,
  listResponseSchema,
  quoteRequestSchema,
  quoteSchema,
  ratePlanPublicSchema,
} from '@pinehill/contracts';
import type { Availability, Quote, QuoteRequest, RatePlanPublic } from '@pinehill/contracts';

function client() {
  return createJourneyApiClient({
    baseUrl: window.location.origin,
    session: { getAccessToken: () => null, onUnauthorized: async () => false },
  });
}

/** Kỳ tìm phòng đã kiểm tại chỗ (SCR-02 truyền xuống SCR-03 qua truy vấn). */
export interface StayCriteria {
  readonly propertyId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly roomCount: number;
}

export async function fetchAvailability(criteria: StayCriteria): Promise<Availability> {
  const query = availabilityQuerySchema.parse({
    propertyId: criteria.propertyId,
    checkIn: criteria.checkIn,
    checkOut: criteria.checkOut,
    adults: criteria.adults,
    children: criteria.children,
    roomCount: criteria.roomCount,
  });
  const response = await client().request({
    method: 'GET',
    path: '/inventory/availability',
    query,
    decoder: availabilitySchema,
  });
  return response.data;
}

export async function fetchRatePlans(criteria: StayCriteria): Promise<readonly RatePlanPublic[]> {
  const response = await client().request({
    method: 'GET',
    path: '/rate-plans',
    query: {
      propertyId: criteria.propertyId,
      checkIn: criteria.checkIn,
      checkOut: criteria.checkOut,
    },
    decoder: listResponseSchema(ratePlanPublicSchema),
  });
  return response.data.data;
}

/** Báo giá kỳ lưu trú — **chỉ** máy chủ tính giá; màn hình in nguyên số trả về (BR-RATE-17). */
export async function fetchQuote(request: QuoteRequest): Promise<Quote> {
  const response = await client().request({
    method: 'POST',
    path: '/quotes',
    body: quoteRequestSchema.parse(request),
    decoder: quoteSchema,
  });
  return response.data;
}
