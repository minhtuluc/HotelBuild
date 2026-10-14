/**
 * Giao diện lưu trữ bảo mật Android. Với token phiên (QĐ-03 quyết định 1), chỉ **refresh token**
 * được lưu bền; access token và pinToken chỉ nằm trong bộ nhớ. Yêu cầu nghiệp vụ được phép lưu
 * dùng namespace riêng; adapter native vẫn dùng Keychain/Keystore.
 * Phần thuần này không import module gốc để test chạy được trên Node; bản thật ở `storage.native.ts`.
 */
export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const SESSION_KEY = 'session.refreshToken';

/** Bản giả cho test: giữ đúng giao diện, không ghi ra ngoài. */
export const memoryStorage = (): KeyValueStorage => {
  const entries = new Map<string, string>();
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => {
      entries.set(key, value);
    },
    remove: async (key) => {
      entries.delete(key);
    },
  };
};
