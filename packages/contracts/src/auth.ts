/**
 * Hợp đồng định danh & phiên — nguồn chân lý: docs/04-thiet-ke/api.md §2 (AUTH), §6.1.
 * Vai trò không có thứ bậc (BR-RBAC-01); phạm vi cơ sở do server quyết (BR-RBAC-02).
 */
import { z } from 'zod';
import { isoUtcTimestampSchema } from './common.js';
import { userRoleSchema } from './enums.js';

/** Số điện thoại đã chuẩn hoá `+84…` là khoá nhận diện khách (BR-CRM-01, NFR-LOC-04). */
export const phoneNumberSchema = z
  .string()
  .regex(/^\+84\d{9}$/, 'Số điện thoại phải ở dạng +84XXXXXXXXX');

export const loginRequestSchema = z.strictObject({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
});

export const refreshRequestSchema = z.strictObject({
  refreshToken: z.string().min(16),
});

/** Phản hồi: bỏ qua trường lạ để client cũ đọc được server mới (api.md §7.1). */
export const tokenPairSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string().min(16),
  /** Access token sống 15 phút (ADR-010). */
  expiresInSeconds: z.number().int().positive(),
  refreshToken: z.string().min(16),
  /** Refresh token sống 7 ngày (ADR-010). */
  refreshExpiresInSeconds: z.number().int().positive(),
});

/** PIN 6 số cho thao tác tài chính trên Android (ADR-010, BR-RBAC-05). */
export const pinVerifyRequestSchema = z.strictObject({
  pin: z.string().regex(/^\d{6}$/, 'PIN phải gồm đúng 6 chữ số'),
  bookingId: z.string().min(1).optional(),
});

/** Phản hồi: bỏ qua trường lạ (api.md §7.1). */
export const pinTokenSchema = z.object({
  pinToken: z.string().min(16),
  expiresAt: isoUtcTimestampSchema,
});

export const guestRegisterRequestSchema = z.strictObject({
  phone: phoneNumberSchema,
  fullName: z.string().min(1).max(120),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128),
  consentMarketing: z.boolean(),
  consentVersion: z.string().min(1),
});

export const guestLoginRequestSchema = z.strictObject({
  phone: phoneNumberSchema,
  password: z.string().min(8).max(128),
});

/**
 * Thân token đã xác thực; client chỉ đọc để hiển thị, KHÔNG tự suy quyền (ADR-018).
 */
export const accessTokenClaimsSchema = z.object({
  userId: z.string().min(1),
  role: userRoleSchema,
  propertyScope: z.array(z.string().min(1)),
  expiresAt: isoUtcTimestampSchema,
});

export const userAccessUpdateRequestSchema = z.strictObject({
  role: userRoleSchema,
  propertyScope: z.array(z.string().min(1)),
  isActive: z.boolean(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
export type PinToken = z.infer<typeof pinTokenSchema>;
export type GuestRegisterRequest = z.infer<typeof guestRegisterRequestSchema>;
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
export type UserAccessUpdateRequest = z.infer<typeof userAccessUpdateRequestSchema>;
