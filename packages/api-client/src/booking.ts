/**
 * Bề mặt F4 (HB-070): báo giá, tạo/đọc/xác nhận booking, giữ và giải phóng chỗ.
 * Request đã parse theo schema `@pinehill/contracts`; lệnh ghi tự mang `Idempotency-Key` (client §1.3).
 */
import {
  bookingConfirmRequestSchema,
  bookingCreateRequestSchema,
  bookingSummarySchema,
  holdCreateRequestSchema,
  holdSchema,
  listResponseSchema,
  quoteRequestSchema,
  quoteSchema,
  type BookingConfirmRequest,
  type BookingCreateRequest,
  type BookingSummary,
  type Hold,
  type HoldCreateRequest,
  type ListPage,
  type Quote,
  type QuoteRequest,
} from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from './client.js';

export interface QuoteApi {
  quote(input: QuoteRequest): Promise<ApiResponse<Quote>>;
}

export function createQuoteApi(client: ApiClient): QuoteApi {
  return {
    quote: (input) =>
      client.request({
        method: 'POST',
        path: '/quotes',
        body: quoteRequestSchema.parse(input),
        decoder: quoteSchema,
      }),
  };
}

export interface BookingApi {
  create(input: BookingCreateRequest): Promise<ApiResponse<BookingSummary>>;
  list(query?: {
    propertyId?: string;
    status?: BookingSummary['status'];
    channelCode?: string;
    from?: string;
    to?: string;
    q?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ApiResponse<ListPage<BookingSummary>>>;
  get(bookingId: string): Promise<ApiResponse<BookingSummary>>;
  confirm(bookingId: string, input: BookingConfirmRequest): Promise<ApiResponse<BookingSummary>>;
  createHold(input: HoldCreateRequest): Promise<ApiResponse<Hold>>;
  releaseHold(holdId: string, reason: string): Promise<ApiResponse<undefined>>;
}

export function createBookingApi(client: ApiClient): BookingApi {
  return {
    create: (input) =>
      client.request({
        method: 'POST',
        path: '/bookings',
        body: bookingCreateRequestSchema.parse(input),
        decoder: bookingSummarySchema,
      }),
    list: (query) =>
      client.request({
        method: 'GET',
        path: '/bookings',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(bookingSummarySchema),
      }),
    get: (bookingId) =>
      client.request({
        method: 'GET',
        path: `/bookings/${encodeURIComponent(bookingId)}`,
        decoder: bookingSummarySchema,
      }),
    confirm: (bookingId, input) =>
      client.request({
        method: 'POST',
        path: `/bookings/${encodeURIComponent(bookingId)}/confirm`,
        body: bookingConfirmRequestSchema.parse(input),
        decoder: bookingSummarySchema,
      }),
    createHold: (input) =>
      client.request({
        method: 'POST',
        path: '/holds',
        body: holdCreateRequestSchema.parse(input),
        decoder: holdSchema,
      }),
    releaseHold: (holdId, reason) =>
      client.requestVoid({
        method: 'DELETE',
        path: `/holds/${encodeURIComponent(holdId)}`,
        query: { reason },
      }),
  };
}
