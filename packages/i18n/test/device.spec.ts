import { describe, expect, it } from 'vitest';
import { matchLocale } from '../src/device';

describe('HB-275 chọn ngôn ngữ theo máy', () => {
  it('khớp thẻ BCP 47 của máy về locale có hỗ trợ', () => {
    expect(matchLocale('vi-VN')).toBe('vi');
    expect(matchLocale('en-US')).toBe('en');
    expect(matchLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(matchLocale('zh-CN')).toBe('zh-CN');
    expect(matchLocale('ja-JP')).toBe('ja');
    expect(matchLocale('ko-KR')).toBe('ko');
    expect(matchLocale('ru-RU')).toBe('ru');
  });

  it('ngôn ngữ chưa hỗ trợ hoặc rỗng thì về tiếng Việt', () => {
    expect(matchLocale('fr-FR')).toBe('vi');
    expect(matchLocale('zh-Hant-TW')).toBe('vi');
    expect(matchLocale('')).toBe('vi');
    expect(matchLocale(undefined)).toBe('vi');
  });
});
