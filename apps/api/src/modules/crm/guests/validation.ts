import { z } from 'zod';
import {
  guestAnonymizeRequestSchema,
  guestBlacklistReleaseQuerySchema,
  guestBlacklistRequestSchema,
  guestCreateRequestSchema,
  guestQuerySchema,
  type GuestAnonymizeRequest,
  type GuestBlacklistRequest,
  type GuestCreateRequest,
  type GuestQuery,
} from '@pinehill/contracts';
import { invalid, uuid } from '../../inv/allotments/validation.js';
import { normalizePhone } from './phone.js';

/** SĐT thô do máy khách gửi (có thể dạng nội địa `0…`); các trường khác giữ nguyên hợp đồng. */
const looseBodySchema = guestCreateRequestSchema
  .omit({ phone: true })
  .extend({ phone: z.string().min(1).max(24) });

export function guestCreateInput(value: unknown): GuestCreateRequest {
  const loose = looseBodySchema.safeParse(value);
  if (!loose.success) throw invalid();
  const parsed = guestCreateRequestSchema.safeParse({
    ...loose.data,
    phone: normalizePhone(loose.data.phone),
  });
  if (!parsed.success) throw invalid();
  return parsed.data;
}

export function guestSearchInput(value: unknown): GuestQuery {
  const result = guestQuerySchema.safeParse(value);
  if (!result.success) throw invalid();
  return {
    ...result.data,
    ...(result.data.propertyId === undefined ? {} : { propertyId: uuid(result.data.propertyId) }),
  };
}

/** `:guestId` của api.md §2.10 là UUID; sai định dạng → `400 E_GEN_VALIDATION_FAILED`. */
export function guestPathId(value: string): string {
  return uuid(value);
}

/** `POST /guests/{guestId}/anonymize` — `reason` + `requestedAt` bắt buộc, không nhận trường lạ. */
export function guestAnonymizeInput(value: unknown): GuestAnonymizeRequest {
  const result = guestAnonymizeRequestSchema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}

/** `POST /guests/{guestId}/blacklist` — lý do bắt buộc (BR-CRM-04). */
export function guestBlacklistInput(value: unknown): GuestBlacklistRequest {
  const result = guestBlacklistRequestSchema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}

/** `DELETE /guests/{guestId}/blacklist` — lý do gỡ bắt buộc, truyền qua query (BR-CRM-04, BR-SYS-05). */
export function guestBlacklistReleaseInput(value: unknown): string {
  const result = guestBlacklistReleaseQuerySchema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data.reason;
}
