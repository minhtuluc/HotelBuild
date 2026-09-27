/**
 * Bề mặt gọi API định danh — chi tiết giao thức (idempotency, PIN, version) nằm ở ApiClient
 * để 4 frontend không tự viết lại (ADR-018).
 */
import {
  guestLoginRequestSchema,
  guestRegisterRequestSchema,
  loginRequestSchema,
  pinTokenSchema,
  tokenPairSchema,
  userAccessUpdateRequestSchema,
  type GuestRegisterRequest,
  type LoginRequest,
  type PinToken,
  type TokenPair,
  type UserAccessUpdateRequest,
} from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from './client.js';

export interface AuthApi {
  login(input: LoginRequest): Promise<ApiResponse<TokenPair>>;
  refresh(refreshToken: string): Promise<ApiResponse<TokenPair>>;
  logout(): Promise<ApiResponse<undefined>>;
  pinVerify(pin: string, bookingId?: string): Promise<ApiResponse<PinToken>>;
  guestRegister(input: GuestRegisterRequest): Promise<ApiResponse<TokenPair>>;
  guestLogin(phone: string, password: string): Promise<ApiResponse<TokenPair>>;
  guestRefresh(refreshToken: string): Promise<ApiResponse<TokenPair>>;
  updateUserAccess(
    userId: string,
    input: UserAccessUpdateRequest,
    ifMatch?: string,
  ): Promise<ApiResponse<undefined>>;
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
    guestLogin: (phone, password) =>
      client.request({
        method: 'POST',
        path: '/guest-auth/login',
        body: guestLoginRequestSchema.parse({ phone, password }),
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
  };
}
