import { describe, expect, it } from 'vitest';
import { formatDateTimeVn as formatDateTimeVnWeb } from '@pinehill/ui-web';
import { makeTranslate as makeWebTranslate, viCatalog } from '@pinehill/ui-web/messages';
import { formatDateTimeVn } from '../src/format.js';
import { color, gridStatus, radius, space, touchTargetDp, typography } from '../src/tokens.js';
import { makeTranslate } from '../src/translate.js';
import { offlineQueueMessages, stateMessages } from '../src/stateMessages.js';

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('token Android (§7)', () => {
  it('mọi cặp nền–chữ của ô lưới đạt tối thiểu 4,5:1', () => {
    for (const [key, token] of Object.entries(gridStatus)) {
      expect(contrastRatio(token.text, token.background), `ô ${key}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('chữ chính và chữ phụ đạt tương phản trên nền trang', () => {
    expect(contrastRatio(color.text, color.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.textMuted, color.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('cấm cỡ chữ nhỏ hơn 12 sp, tiền không nhỏ hơn 14 sp', () => {
    for (const token of Object.values(typography)) expect(token.sp).toBeGreaterThanOrEqual(12);
    expect(typography.money.sp).toBeGreaterThanOrEqual(14);
  });

  it('vùng chạm 48 dp và thang khoảng cách tăng dần', () => {
    expect(touchTargetDp).toBe(48);
    const scale = [
      space.s1,
      space.s2,
      space.s3,
      space.s4,
      space.s6,
      space.s8,
      space.s10,
      space.s12,
    ];
    expect(scale).toEqual([...scale].sort((a, b) => a - b));
    expect(radius.full).toBeGreaterThan(radius.lg);
  });
});

describe('câu chữ dùng chung giữa web và Android', () => {
  it('cùng tập khoá và cùng nội dung, tránh lệch câu chữ giữa hai nền tảng', () => {
    expect({ ...stateMessages }).toEqual({ ...viCatalog });
  });

  it('trạng thái hàng đợi ngoại tuyến có nhãn riêng cho cả 5 bước (§8.3)', () => {
    expect(Object.keys(offlineQueueMessages)).toEqual([
      'draft',
      'pendingSync',
      'sending',
      'confirmed',
      'needsAttention',
    ]);
  });
});

describe('nội suy câu chữ khớp giữa hai nền tảng', () => {
  it('cùng đầu vào cho cùng kết quả như makeTranslate của web', () => {
    const native = makeTranslate(stateMessages);
    const web = makeWebTranslate(viCatalog);
    const vars = { time: '12/11/2026 14:00 (giờ VN)', count: 2, reference: 'trace-9' };
    expect(native('state.refreshing', vars)).toBe(web('state.refreshing', vars));
    expect(native('state.conflict', vars)).toBe(web('state.conflict', vars));
    expect(native('state.validation', vars)).toBe(web('state.validation', vars));
  });

  it('giữ nguyên {tên} khi thiếu biến thay vì in undefined', () => {
    expect(makeTranslate(stateMessages)('state.refreshing')).toContain('{time}');
  });
});

describe('định dạng thời gian giống web (F0-08)', () => {
  it('cùng đầu vào cho cùng chuỗi như bản web, kèm nhãn giờ VN', () => {
    const samples = [
      '2026-11-12T07:00:00.000Z',
      '2026-01-01T17:00:00.000Z',
      '2026-06-30T23:59:00.000Z',
    ];
    for (const sample of samples) {
      expect(formatDateTimeVn(sample)).toBe(formatDateTimeVnWeb(sample));
      expect(formatDateTimeVn(sample)).toContain('(giờ VN)');
    }
  });

  it('từ chối mốc không hợp lệ thay vì hiện Invalid Date', () => {
    expect(() => formatDateTimeVn('khong-phai-ngay')).toThrow(RangeError);
  });
});
