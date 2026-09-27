import { describe, expect, it } from 'vitest';
import { readWebEnv } from '../src/config/index';

describe('cấu hình web (kiến trúc §7.5, NFR-MAIN-05)', () => {
  it('nhận cấu hình hợp lệ', () => {
    expect(readWebEnv({ NEXT_PUBLIC_API_BASE_URL: 'https://api.pinehill.vn/api/v1' })).toEqual({
      NEXT_PUBLIC_API_BASE_URL: 'https://api.pinehill.vn/api/v1',
    });
  });

  it('thiếu biến thì dừng với thông báo nêu rõ tên biến', () => {
    expect(() => readWebEnv({})).toThrow(/NEXT_PUBLIC_API_BASE_URL/);
  });

  it('từ chối giá trị không phải URL đầy đủ', () => {
    expect(() => readWebEnv({ NEXT_PUBLIC_API_BASE_URL: '/api/v1' })).toThrow(
      /NEXT_PUBLIC_API_BASE_URL/,
    );
  });
});
