/**
 * Bề mặt gọi API định danh — chi tiết giao thức (idempotency, PIN, version) nằm ở ApiClient
 * để 4 frontend không tự viết lại (ADR-018).
 */
import {
  changePasswordRequestSchema,
  guestLoginRequestSchema,
  guestRegisterRequestSchema,
  loginRequestSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestSchema,
  pinTokenSchema,
  setPinRequestSchema,
  tokenPairSchema,
  userAccessUpdateRequestSchema,
  userMeSchema,
  type ChangePasswordRequest,
  type GuestRegisterRequest,
  type LoginRequest,
  type PasswordResetConfirmRequest,
  type PasswordResetRequest,
  type PinToken,
  type SetPinRequest,
  type TokenPair,
  type UserAccessUpdateRequest,
  type UserMe,
} from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from './client.js';

export interface AuthApi {
  login(input: LoginRequest): Promise<ApiResponse<TokenPair>>;
  refresh(refreshToken: string): Promise<ApiResponse<TokenPair>>;
  logout(): Promise<ApiResponse<undefined>>;
  pinVerify(pin: string, bookingId?: string): Promise<ApiResponse<PinToken>>;
  guestRegister(input: GuestRegisterRequest): Promise<ApiResponse<TokenPair>>;
  guestLogin(
    phone: string,
    password: string,
    clientSurface?: 'GUEST_WEB' | 'GUEST_ANDROID',
  ): Promise<ApiResponse<TokenPair>>;
  guestRefresh(refreshToken: string): Promise<ApiResponse<TokenPair>>;
  /** Hồ sơ phiên hiện tại (HB-012): dùng để biết `hasPin`, `propertyScope`, `mustChangePassword`. */
  me(): Promise<ApiResponse<UserMe>>;
  updateUserAccess(
    userId: string,
    input: UserAccessUpdateRequest,
    ifMatch?: string,
  ): Promise<ApiResponse<undefined>>;
  changePassword(input: ChangePasswordRequest): Promise<ApiResponse<undefined>>;
  setPin(input: SetPinRequest): Promise<ApiResponse<undefined>>;
  passwordResetRequest(input: PasswordResetRequest): Promise<ApiResponse<undefined>>;
  passwordResetConfirm(input: PasswordResetConfirmRequest): Promise<ApiResponse<undefined>>;
}

export function createAuthApi(client: ApiClient): AuthApi {
  return {
    login: (input) =>
      client.request({
        method: 'POST',
        path: '/auth/login',
        body: loginRequestSchema.parse(input),
        decoder: tokenPairSchema,
      }),
    refresh: (refreshToken) =>
      client.request({
        method: 'POST',
        path: '/auth/refresh',
        body: { refreshToken },
        decoder: tokenPairSchema,
      }),
    logout: () => client.requestVoid({ method: 'POST', path: '/auth/logout' }),
    pinVerify: (pin, bookingId) =>
      client.request({
        method: 'POST',
        path: '/auth/pin/verify',
        body: bookingId === undefined ? { pin } : { pin, bookingId },
        decoder: pinTokenSchema,
      }),
    guestRegister: (input) =>
      client.request({
        method: 'POST',
        path: '/guest-auth/register',
        body: guestRegisterRequestSchema.parse(input),
        decoder: tokenPairSchema,
      }),
    me: () => client.request({ method: 'GET', path: '/auth/me', decoder: userMeSchema }),
    guestLogin: (phone, password, clientSurface) =>
      client.request({
        method: 'POST',
        path: '/guest-auth/login',
        body: guestLoginRequestSchema.parse({
          phone,
          password,
          ...(clientSurface === undefined ? {} : { clientSurface }),
        }),
        decoder: tokenPairSchema,
      }),
    guestRefresh: (refreshToken) =>
      client.request({
        method: 'POST',
        path: '/guest-auth/refresh',
        body: { refreshToken },
        decoder: tokenPairSchema,
      }),
    updateUserAccess: (userId, input, ifMatch) =>
      client.requestVoid({
        method: 'PUT',
        path: `/users/${encodeURIComponent(userId)}/access`,
        body: userAccessUpdateRequestSchema.parse(input),
        ...(ifMatch === undefined ? {} : { ifMatch }),
      }),
    changePassword: (input) =>
      client.requestVoid({
        method: 'POST',
        path: '/auth/password',
        body: changePasswordRequestSchema.parse(input),
      }),
    setPin: (input) =>
      client.requestVoid({
        method: 'PUT',
        path: '/auth/pin',
        body: setPinRequestSchema.parse(input),
      }),
    passwordResetRequest: (input) =>
      client.requestVoid({
        method: 'POST',
        path: '/guest-auth/password-reset/request',
        body: passwordResetRequestSchema.parse(input),
      }),
    passwordResetConfirm: (input) =>
      client.requestVoid({
        method: 'POST',
        path: '/guest-auth/password-reset/confirm',
        body: passwordResetConfirmRequestSchema.parse(input),
      }),
  };
}
