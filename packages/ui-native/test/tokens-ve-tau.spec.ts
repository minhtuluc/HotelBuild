import { describe, expect, it } from 'vitest';
import { color as webColor, radius as webRadius, worldInk as webInk } from '@pinehill/ui-web';
import { color, fontFamily, radius, typography, worldInk } from '../src/tokens.js';

describe('HB-272 token vé tàu', () => {
  it('màu trùng đúng giá trị của web', () => {
    expect(color).toEqual(webColor);
    expect(worldInk).toEqual(webInk);
  });

  it('bo góc gần vuông như web', () => {
    expect(radius).toEqual(webRadius);
  });

  it('có kiểu nhãn và bảng ga, không nhỏ hơn 12sp', () => {
    expect(typography.label.sp).toBe(12);
    expect(typography.board.fontVariant).toEqual(['tabular-nums']);
    expect(typography.board.sp).toBeGreaterThanOrEqual(14);
  });

  it('họ chữ đổi theo độ đậm (Android không tổng hợp fontWeight cho font tự nạp)', () => {
    expect(fontFamily).toEqual({
      sans: 'BeVietnamPro_400Regular',
      sansMedium: 'BeVietnamPro_500Medium',
      sansSemiBold: 'BeVietnamPro_600SemiBold',
      sansBold: 'BeVietnamPro_700Bold',
      display: 'BarlowCondensed_500Medium',
      displaySemiBold: 'BarlowCondensed_600SemiBold',
    });
  });
});
