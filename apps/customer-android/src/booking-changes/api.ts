import { ApiError, createBookingApi, createQuoteApi, type ApiClient } from '@pinehill/api-client';
import {
  businessDateSchema,
  cancelRequestSchema,
  cancelResponseSchema,
  bookingSummarySchema,
  channelCodeSchema,
  ratePlanCodeSchema,
  rescheduleRequestSchema,
  type BookingSummary,
} from '@pinehill/contracts';
import type { ChangeApi, ChangeKind } from './types';

function dateValid(value: string): boolean {
  if (!businessDateSchema.safeParse(value).success) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}
export function validateStay(checkIn: string, checkOut: string, booking: BookingSummary): boolean {
  return (
    dateValid(checkIn) &&
    dateValid(checkOut) &&
    checkIn < checkOut &&
    (checkIn !== booking.checkIn || checkOut !== booking.checkOut)
  );
}
function invalid(code = 'E_GEN_VALIDATION_FAILED'): never {
  throw new ApiError({ kind: 'http', status: 422, code, message: 'Invalid change input' });
}
function assertGuestCancellation(reason: string, force: boolean): void {
  if (reason !== 'GUEST_REQUEST' || force)
    throw new ApiError({
      kind: 'http',
      status: 403,
      code: 'E_RBAC_FORBIDDEN',
      message: 'Guest cancellation only',
    });
}
export function changeApiFrom(
  client: ApiClient,
  booking: BookingSummary,
  kind: ChangeKind,
): ChangeApi {
  const bookings = createBookingApi(client),
    quotes = createQuoteApi(client);
  return {
    preview: async (draft) => {
      if (kind === 'cancel')
        assertGuestCancellation(draft.reason, draft.reason === 'FORCE_MAJEURE');
      if (kind === 'cancel') {
        return {
          kind,
          data: (
            await bookings.cancelPreview(booking.id, {
              reason: draft.reason,
              isForceMajeure: draft.reason === 'FORCE_MAJEURE',
            })
          ).data,
        };
      }
      if (!validateStay(draft.checkIn, draft.checkOut, booking)) invalid();
      const channel = channelCodeSchema.safeParse(booking.channelCode);
      const plan = ratePlanCodeSchema.safeParse(booking.ratePlanCode);
      if (!channel.success || !plan.success) invalid('E_RATE_CONFIGURATION_INVALID');
      const response = await quotes.quote({
        propertyId: booking.propertyId,
        roomTypeId: booking.roomTypeId,
        channelCode: channel.data,
        ratePlanCode: plan.data,
        checkIn: draft.checkIn,
        checkOut: draft.checkOut,
        adults: booking.adults,
        children: booking.children,
        roomCount: booking.roomCount,
      });
      if (response.data.channelCode !== channel.data || response.data.ratePlanCode !== plan.data)
        invalid();
      return { kind, data: response.data };
    },
    commit: async (intent) => {
      if (intent.kind !== kind || intent.bookingId !== booking.id) invalid();
      const common = {
        method: 'POST' as const,
        path: `/bookings/${encodeURIComponent(booking.id)}/${kind === 'cancel' ? 'cancel' : 'reschedule'}`,
        ifMatch: intent.etag,
        idempotencyKey: intent.key,
        maxAttempts: 1,
      };
      if (kind === 'cancel') {
        const request = cancelRequestSchema.parse(intent.body);
        assertGuestCancellation(request.reason, request.isForceMajeure);
        return {
          kind,
          data: (
            await client.request({
              ...common,
              body: request,
              decoder: cancelResponseSchema,
            })
          ).data,
        };
      }
      return {
        kind,
        data: (
          await client.request({
            ...common,
            body: rescheduleRequestSchema.parse(intent.body),
            decoder: bookingSummarySchema,
          })
        ).data,
      };
    },
  };
}
