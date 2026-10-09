/**
 * Lớp gọi API cho SCR-13: hai tuyến **cần phiên khách** (`GET /guests/me`, `GET /guests/me/loyalty`) —
 * máy chủ tự xác định khách từ phiên, client không gửi `guestId` nào.
 */
import { createJourneyApiClient } from '@pinehill/web-session/client';
import type { JourneySession } from '@pinehill/web-session/client';
import { guestLoyaltySchema, guestSummarySchema } from '@pinehill/contracts';
import type { GuestLoyalty, GuestSummary } from '@pinehill/contracts';

export async function fetchMyProfile(session: JourneySession): Promise<GuestSummary> {
  const client = createJourneyApiClient({ baseUrl: window.location.origin, session });
  const response = await client.request({
    method: 'GET',
    path: '/guests/me',
    decoder: guestSummarySchema,
  });
  return response.data;
}

export async function fetchMyLoyalty(session: JourneySession): Promise<GuestLoyalty> {
  const client = createJourneyApiClient({ baseUrl: window.location.origin, session });
  const response = await client.request({
    method: 'GET',
    path: '/guests/me/loyalty',
    decoder: guestLoyaltySchema,
  });
  return response.data;
}
