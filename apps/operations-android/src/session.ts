/**
 * Phiên nhân viên Android (SCR-56). Quản lý access token (bộ nhớ) và refresh token (secure
 * storage); mở khoá PIN trả `pinToken` chỉ trong bộ nhớ. Logic thuần để test không cần UI.
 */
import { ApiClient, createAuthApi, isApiError, type AuthApi } from '@pinehill/api-client';
import type { KeyValueStorage } from './storage.js';
import { SESSION_KEY } from './storage.js';
import { OfflineError, requireOnline, type NetInfoSource } from './netinfo.js';

export const PIN_LOCK_SECONDS = 900;

export interface SessionDeps {
  storage: KeyValueStorage;
  baseUrl: string;
  createId: () => string;
  netInfo: NetInfoSource;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface LoginOutcome {
  mustChangePassword: boolean;
}

export class Session {
  private accessToken: string | null = null;
  private pinToken: string | null = null;
  private readonly auth: AuthApi;

  constructor(private readonly deps: SessionDeps) {
    const client = new ApiClient({
      baseUrl: deps.baseUrl,
      createId: deps.createId,
      getAccessToken: () => this.accessToken,
      getPinToken: () => this.pinToken,
      ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
    });
    this.auth = createAuthApi(client);
  }

  hasAccessToken(): boolean {
    return this.accessToken !== null;
  }

  hasRefreshTokenInStorage(): Promise<string | null> {
    return this.deps.storage.get(SESSION_KEY);
  }

  /** Đăng nhập nội bộ từ bề mặt Android (T10). Lưu refresh token, giữ access token trong bộ nhớ. */
  async login(username: string, password: string): Promise<LoginOutcome> {
    await requireOnline(this.deps.netInfo);
    const response = await this.auth.login({ username, password, clientSurface: 'OPS_ANDROID' });
    this.accessToken = response.data.accessToken;
    await this.deps.storage.set(SESSION_KEY, response.data.refreshToken);
    return { mustChangePassword: response.data.mustChangePassword === true };
  }

  /** Mở lại app: refresh im lặng. Trả `false` khi hết phiên (401) và đã xoá secure storage. */
  async silentRefresh(): Promise<boolean> {
    const refreshToken = await this.deps.storage.get(SESSION_KEY);
    if (refreshToken === null) return false;
    await requireOnline(this.deps.netInfo);
    try {
      const response = await this.auth.refresh(refreshToken);
      this.accessToken = response.data.accessToken;
      await this.deps.storage.set(SESSION_KEY, response.data.refreshToken);
      return true;
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        await this.logout();
        return false;
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    this.accessToken = null;
    this.pinToken = null;
    await this.deps.storage.remove(SESSION_KEY);
  }

  async changePassword(current: string, next: string): Promise<void> {
    await requireOnline(this.deps.netInfo);
    await this.auth.changePassword({ currentPassword: current, newPassword: next });
  }

  async setPin(pin: string, currentPassword: string): Promise<void> {
    await requireOnline(this.deps.netInfo);
    await this.auth.setPin({ pin, currentPassword });
  }

  /** Mở khoá thao tác cần PIN: gọi `pin/verify`, trả `pinToken` (giữ trong bộ nhớ, không ghi đĩa). */
  async verifyPin(pin: string, bookingId?: string): Promise<string> {
    await requireOnline(this.deps.netInfo);
    const response = await this.auth.pinVerify(pin, bookingId);
    this.pinToken = response.data.pinToken;
    return this.pinToken;
  }

  /** `pinToken` dùng một lần; xoá sau khi đã gọi endpoint 🔒. */
  clearPinToken(): void {
    this.pinToken = null;
  }

  /** Ném `OfflineError` để UI phân biệt với lỗi API. */
  static isOffline(error: unknown): error is OfflineError {
    return error instanceof OfflineError;
  }
}
