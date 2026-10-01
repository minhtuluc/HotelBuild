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

/** Bề mặt client cho phiên nội bộ (QĐ-03 T10); mặc định `OPS_WEB`. */
export const opsClientSurfaceSchema = z.enum(['OPS_WEB', 'OPS_ANDROID']);

/** Bề mặt client cho phiên khách (QĐ-03 T10); mặc định `GUEST_WEB`. */
export const guestClientSurfaceSchema = z.enum(['GUEST_WEB', 'GUEST_ANDROID']);

export const loginRequestSchema = z.strictObject({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
  clientSurface: opsClientSurfaceSchema.optional(),
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
  /** Bắt buộc đổi mật khẩu ở lần đăng nhập đầu (QĐ-03 quyết định 8). */
  mustChangePassword: z.boolean().optional(),
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
  clientSurface: guestClientSurfaceSchema.optional(),
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

/** Bản tóm tắt người dùng nội bộ cho SCR-15 (QĐ-03 T6). */
export const userSummarySchema = z.object({
  id: z.string().min(1),
  username: z.string().min(3).max(64),
  fullName: z.string().min(1).max(120),
  role: userRoleSchema,
  propertyScope: z.array(z.string().min(1)),
  isActive: z.boolean(),
  lockedUntil: isoUtcTimestampSchema.nullable(),
  hasPin: z.boolean(),
  version: z.number().int().min(0),
});

/** Bộ lọc danh sách người dùng (api.md §2.1, `GET /users`). */
export const usersQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  role: userRoleSchema.optional(),
  propertyId: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
});

export const createUserRequestSchema = z.strictObject({
  username: z.string().min(3).max(64),
  fullName: z.string().min(1).max(120),
  phone: phoneNumberSchema.optional(),
  role: userRoleSchema,
  propertyScope: z.array(z.string().min(1)),
  temporaryPassword: z.string().min(8).max(128),
});

/** Đổi mật khẩu của chính mình; mật khẩu mới 8–128 ký tự (QĐ-03 T6). */
export const changePasswordRequestSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

/** Đặt PIN cho chính mình (QĐ-03 quyết định 5). */
export const setPinRequestSchema = z.strictObject({
  pin: z.string().regex(/^\d{6}$/, 'PIN phải gồm đúng 6 chữ số'),
  currentPassword: z.string().min(1).max(128),
});

/** Yêu cầu đặt lại mật khẩu khách; luôn trả 202 dù SĐT có tồn tại hay không (QĐ-03 T7). */
export const passwordResetRequestSchema = z.strictObject({
  phone: phoneNumberSchema,
});

export const passwordResetConfirmRequestSchema = z.strictObject({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
export type PinToken = z.infer<typeof pinTokenSchema>;
export type GuestRegisterRequest = z.infer<typeof guestRegisterRequestSchema>;
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
export type UserAccessUpdateRequest = z.infer<typeof userAccessUpdateRequestSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type UsersQuery = z.infer<typeof usersQuerySchema>;
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type SetPinRequest = z.infer<typeof setPinRequestSchema>;
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmRequest = z.infer<typeof passwordResetConfirmRequestSchema>;
