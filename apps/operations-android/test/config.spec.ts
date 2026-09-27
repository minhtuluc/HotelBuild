import { describe, expect, it } from 'vitest';
import { readMobileEnv } from '../src/config/index';

describe('cấu hình Android (operations) (kiến trúc §7.5, NFR-MAIN-05)', () => {
  it('nhận cấu hình hợp lệ cho cả ba biến thể build', () => {
    for (const variant of ['development', 'preview', 'production'] as const) {
      expect(
        readMobileEnv({
          EXPO_PUBLIC_API_BASE_URL: 'https://api.pinehill.vn/api/v1',
          EXPO_PUBLIC_APP_VARIANT: variant,
        }).EXPO_PUBLIC_APP_VARIANT,
      ).toBe(variant);
    }
  });

  it('thiếu biến thì dừng với thông báo nêu rõ tên biến', () => {
    expect(() => readMobileEnv({ EXPO_PUBLIC_APP_VARIANT: 'preview' })).toThrow(
      /EXPO_PUBLIC_API_BASE_URL/,
    );
  });

  it('từ chối biến thể build lạ', () => {
    expect(() =>
      readMobileEnv({
        EXPO_PUBLIC_API_BASE_URL: 'https://api.pinehill.vn/api/v1',
        EXPO_PUBLIC_APP_VARIANT: 'staging',
      }),
    ).toThrow(/EXPO_PUBLIC_APP_VARIANT/);
  });
});
