import { z } from 'zod';
import {
  guestCreateRequestSchema,
  guestQuerySchema,
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
