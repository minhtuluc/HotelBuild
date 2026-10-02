/**
 * Phiên khách Android (SCR-71). Đăng ký, đăng nhập, khôi phục phiên và yêu cầu quên mật khẩu.
 * Chỉ refresh token xuống secure storage; access token trong bộ nhớ. Thuần để test không cần UI.
 */
import { ApiClient, createAuthApi, isApiError, type AuthApi } from '@pinehill/api-client';
import type { KeyValueStorage } from './storage.js';
import { SESSION_KEY } from './storage.js';
import { OfflineError, requireOnline, type NetInfoSource } from './netinfo.js';

export interface SessionDeps {
  storage: KeyValueStorage;
  baseUrl: string;
  createId: () => string;
  netInfo: NetInfoSource;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Chuẩn hoá SĐT để hiển thị (`+84`…): 0x… hoặc 84x… về `+84…`. */
export function displayPhone(raw: string): string {
  const trimmed = raw.replace(/[^\d+]/g, '');
  if (trimmed.startsWith('+84')) return trimmed;
  if (trimmed.startsWith('84')) return `+${trimmed}`;
  if (trimmed.startsWith('0')) return `+84${trimmed.slice(1)}`;
  return trimmed;
}

export class Session {
  private accessToken: string | null = null;
  private readonly auth: AuthApi;

  constructor(private readonly deps: SessionDeps) {
    const client = new ApiClient({
      baseUrl: deps.baseUrl,
      createId: deps.createId,
      getAccessToken: () => this.accessToken,
      // Access token hết hạn 15 phút: refresh im lặng rồi gửi lại request đúng một lần (HB-012).
      onUnauthorized: () => this.silentRefresh(),
      ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
    });
    this.auth = createAuthApi(client);
  }

  hasAccessToken(): boolean {
    return this.accessToken !== null;
  }

  async register(input: {
    phone: string;
    fullName: string;
    email?: string;
    password: string;
    consentMarketing: boolean;
    consentVersion: string;
  }): Promise<void> {
    await requireOnline(this.deps.netInfo);
    const response = await this.auth.guestRegister({
      phone: displayPhone(input.phone),
      fullName: input.fullName,
      password: input.password,
      consentMarketing: input.consentMarketing,
      consentVersion: input.consentVersion,
      clientSurface: 'GUEST_ANDROID',
      ...(input.email === undefined ? {} : { email: input.email }),
    });
    this.accessToken = response.data.accessToken;
    await this.deps.storage.set(SESSION_KEY, response.data.refreshToken);
  }

  async login(phone: string, password: string): Promise<void> {
    await requireOnline(this.deps.netInfo);
    const response = await this.auth.guestLogin(displayPhone(phone), password, 'GUEST_ANDROID');
    this.accessToken = response.data.accessToken;
    await this.deps.storage.set(SESSION_KEY, response.data.refreshToken);
  }

  /** Mở lại app: refresh im lặng; 401 → xoá storage và về đăng nhập. */
  async silentRefresh(): Promise<boolean> {
    const refreshToken = await this.deps.storage.get(SESSION_KEY);
    if (refreshToken === null) return false;
    await requireOnline(this.deps.netInfo);
    try {
      const response = await this.auth.guestRefresh(refreshToken);
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

  /** Thu hồi phiên trên máy chủ trước, rồi luôn xoá secure storage (kể cả lỗi/mất mạng — HB-012). */
  async logout(): Promise<void> {
    try {
      if (this.accessToken !== null) await this.auth.logout();
    } catch {
      // Bỏ qua: phiên cục bộ vẫn phải bị xoá dù máy chủ không trả lời.
    }
    this.accessToken = null;
    await this.deps.storage.remove(SESSION_KEY);
  }

  async passwordResetRequest(phone: string): Promise<void> {
    await requireOnline(this.deps.netInfo);
    await this.auth.passwordResetRequest({ phone: displayPhone(phone) });
  }

  static isOffline(error: unknown): error is OfflineError {
    return error instanceof OfflineError;
  }
}
