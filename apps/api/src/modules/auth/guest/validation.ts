/**
 * Thân lệnh `/guest-auth/*` (HB-017). Hợp đồng đã phát hành (`guestRegisterRequestSchema`,
 * `guestLoginRequestSchema`) bắt `phone` đúng mẫu canonical ngay ở zod ⇒ 400; nhưng BR-CRM-01 chuẩn hoá
 * `0…`/`84…`/`+84…` về một khoá và sai mẫu phải là `422 E_CRM_PHONE_INVALID`. Vì vậy `phone` ở đây là chuỗi
 * tự do (giới hạn độ dài), phần còn lại giữ nguyên `strictObject` của hợp đồng (không gán thừa quyền/điểm/cờ).
 */
import { z } from 'zod';
import { guestLoginRequestSchema, guestRegisterRequestSchema } from '@pinehill/contracts';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../../common/app-error.js';
import { normalizePhone } from '../../crm/guests/phone.js';

const rawPhone = z.string().max(64);

const registerBody = guestRegisterRequestSchema.extend({ phone: rawPhone });
const loginBody = guestLoginRequestSchema.extend({ phone: rawPhone });

export interface RegisterCommand {
  readonly phone: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly password: string;
  readonly consentMarketing: boolean;
  readonly consentVersion: string;
  readonly surface: GuestSurface;
}

export interface LoginCommand {
  readonly phone: string;
  readonly password: string;
  readonly surface: GuestSurface;
}

export type GuestSurface = 'GUEST_WEB' | 'GUEST_ANDROID';

export interface RequestContext {
  readonly ip: string | null;
  readonly correlationId: string;
}

export function validationFailed(): AppError {
  return new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');
}

/** Cú pháp (400) rồi mới tới SĐT (422), để SĐT sai không che lỗi trường khác. */
export function registerCommand(body: unknown): RegisterCommand {
  const parsed = registerBody.safeParse(body);
  if (!parsed.success) throw validationFailed();
  const input = parsed.data;
  return {
    phone: normalizePhone(input.phone),
    fullName: input.fullName,
    email: input.email ?? null,
    password: input.password,
    consentMarketing: input.consentMarketing,
    consentVersion: input.consentVersion,
    surface: input.clientSurface ?? 'GUEST_WEB',
  };
}

export function loginCommand(body: unknown): LoginCommand {
  const parsed = loginBody.safeParse(body);
  if (!parsed.success) throw validationFailed();
  return {
    phone: normalizePhone(parsed.data.phone),
    password: parsed.data.password,
    surface: parsed.data.clientSurface ?? 'GUEST_WEB',
  };
}

export function requestContext(request: FastifyRequest): RequestContext {
  const header = request.headers['x-correlation-id'];
  return {
    ip: request.ip ?? null,
    correlationId: typeof header === 'string' && header !== '' ? header : (request.id ?? ''),
  };
}
