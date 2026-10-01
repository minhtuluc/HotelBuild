/** Giao diện lưu trữ bảo mật — thuần để test chạy trên Node; bản thật ở `storage.native.ts`. */
export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const SESSION_KEY = 'session.refreshToken';

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
