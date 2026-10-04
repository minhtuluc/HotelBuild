/**
 * Bề mặt F3 (HB-050): lịch giá, mùa, kênh, khuyến mãi, báo giá đa kênh, gói giá, chính sách huỷ.
 * Lệnh sửa đối tượng có version dùng `If-Match`; giá đã chốt nằm ở price snapshot bất biến (BR-RATE-16).
 */
import {
  cancellationPolicySchema,
  cancellationPolicyUpdateRequestSchema,
  channelUpdateRequestSchema,
  listResponseSchema,
  promotionSummarySchema,
  multiChannelQuoteRequestSchema,
  multiChannelQuoteSchema,
  promotionCreateRequestSchema,
  rateCalendarOverrideRequestSchema,
  rateCalendarSchema,
  ratePlanPublicSchema,
  ratePlanUpdateRequestSchema,
  seasonCreateRequestSchema,
  type CancellationPolicy,
  type CancellationPolicyUpdateRequest,
  type ChannelUpdateRequest,
  type ListPage,
  type MultiChannelQuote,
  type PromotionCreateRequest,
  type PromotionSummary,
  type RateCalendar,
  type RateCalendarOverrideRequest,
  type RatePlanPublic,
  type RatePlanUpdateRequest,
  type SeasonCreateRequest,
} from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from './client.js';

export interface RateApi {
  rateCalendar(
    roomTypeId: string,
    query: { from: string; to: string; source?: 'BASE' | 'SEASON' | 'OVERRIDE' | 'RATE_PLAN' },
  ): Promise<ApiResponse<RateCalendar>>;
  putRateCalendar(
    roomTypeId: string,
    input: RateCalendarOverrideRequest,
  ): Promise<ApiResponse<RateCalendar>>;
  createSeason(input: SeasonCreateRequest): Promise<ApiResponse<undefined>>;
  updateChannel(
    channelId: string,
    input: ChannelUpdateRequest,
    ifMatch: string,
  ): Promise<ApiResponse<undefined>>;
  listPromotions(query?: {
    propertyId?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    limit?: number;
    cursor?: string;
  }): Promise<ApiResponse<ListPage<PromotionSummary>>>;
  createPromotion(input: PromotionCreateRequest): Promise<ApiResponse<undefined>>;
  quoteMultiChannel(input: {
    roomTypeId: string;
    checkIn: string;
    checkOut: string;
    channelCodes: readonly (
      'WEB' | 'PHONE' | 'WALK_IN' | 'OTA_BOOKING' | 'OTA_AGODA' | 'OTA_AIRBNB' | 'AGENCY'
    )[];
  }): Promise<ApiResponse<MultiChannelQuote>>;
  listRatePlans(query?: {
    propertyId?: string;
    checkIn?: string;
    checkOut?: string;
  }): Promise<ApiResponse<ListPage<RatePlanPublic>>>;
  updateRatePlan(
    ratePlanId: string,
    input: RatePlanUpdateRequest,
    ifMatch: string,
  ): Promise<ApiResponse<undefined>>;
  listCancellationPolicies(query?: {
    status?: 'ACTIVE' | 'INACTIVE';
  }): Promise<ApiResponse<ListPage<CancellationPolicy>>>;
  updateCancellationPolicy(
    policyId: string,
    input: CancellationPolicyUpdateRequest,
    ifMatch: string,
  ): Promise<ApiResponse<CancellationPolicy>>;
}

export function createRateApi(client: ApiClient): RateApi {
  return {
    rateCalendar: (roomTypeId, query) =>
      client.request({
        method: 'GET',
        path: `/room-types/${encodeURIComponent(roomTypeId)}/rate-calendar`,
        query,
        decoder: rateCalendarSchema,
      }),
    putRateCalendar: (roomTypeId, input) =>
      client.request({
        method: 'PUT',
        path: `/room-types/${encodeURIComponent(roomTypeId)}/rate-calendar`,
        body: rateCalendarOverrideRequestSchema.parse(input),
        decoder: rateCalendarSchema,
      }),
    createSeason: (input) =>
      client.requestVoid({
        method: 'POST',
        path: '/seasons',
        body: seasonCreateRequestSchema.parse(input),
      }),
    updateChannel: (channelId, input, ifMatch) =>
      client.requestVoid({
        method: 'PATCH',
        path: `/channels/${encodeURIComponent(channelId)}`,
        body: channelUpdateRequestSchema.parse(input),
        ifMatch,
      }),
    listPromotions: (query) =>
      client.request({
        method: 'GET',
        path: '/promotions',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(promotionSummarySchema),
      }),
    createPromotion: (input) =>
      client.requestVoid({
        method: 'POST',
        path: '/promotions',
        body: promotionCreateRequestSchema.parse(input),
      }),
    quoteMultiChannel: (input) =>
      client.request({
        method: 'POST',
        path: '/quotes/multi-channel',
        body: multiChannelQuoteRequestSchema.parse(input),
        decoder: multiChannelQuoteSchema,
      }),
    listRatePlans: (query) =>
      client.request({
        method: 'GET',
        path: '/rate-plans',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(ratePlanPublicSchema),
      }),
    updateRatePlan: (ratePlanId, input, ifMatch) =>
      client.requestVoid({
        method: 'PUT',
        path: `/rate-plans/${encodeURIComponent(ratePlanId)}`,
        body: ratePlanUpdateRequestSchema.parse(input),
        ifMatch,
      }),
    listCancellationPolicies: (query) =>
      client.request({
        method: 'GET',
        path: '/cancellation-policies',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(cancellationPolicySchema),
      }),
    updateCancellationPolicy: (policyId, input, ifMatch) =>
      client.request({
        method: 'PUT',
        path: `/cancellation-policies/${encodeURIComponent(policyId)}`,
        body: cancellationPolicyUpdateRequestSchema.parse(input),
        ifMatch,
        decoder: cancellationPolicySchema,
      }),
  };
}
