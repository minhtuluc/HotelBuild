import { describe, expect, it } from 'vitest';
import { tokensToCssVariables } from '../src/css.js';
import { color, gridStatus, radius, space, touchTargetPx, typography } from '../src/tokens.js';

/** Độ chói tương đối theo WCAG 2.1. */
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

describe('token thiết kế (§7)', () => {
  it('mọi cặp nền–chữ của ô lưới trạng thái đạt tối thiểu 4,5:1', () => {
    for (const [key, token] of Object.entries(gridStatus)) {
      expect(contrastRatio(token.text, token.background), `ô ${key}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('chữ chính và chữ phụ đạt tương phản trên nền trang và nền thẻ', () => {
    expect(contrastRatio(color.text, color.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.text, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.textMuted, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.primary, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.danger, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.warning, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.success, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.info, color.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('mỗi trạng thái ô lưới có ký hiệu chữ riêng, không truyền đạt chỉ bằng màu', () => {
    const symbols = Object.values(gridStatus).map((token) => token.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(gridStatus.otaClosed.dashedBorder).toBe(color.borderStrong);
  });

  it('cấm cỡ chữ nhỏ hơn 12 px và tiền không nhỏ hơn 14 px', () => {
    for (const token of Object.values(typography)) {
      expect(Number.parseFloat(token.web)).toBeGreaterThanOrEqual(12);
    }
    expect(Number.parseFloat(typography.money.web)).toBeGreaterThanOrEqual(14);
    expect(typography.money.fontVariantNumeric).toBe('tabular-nums');
  });

  it('vùng chạm web tối thiểu 44 px và thang khoảng cách tăng dần', () => {
    expect(touchTargetPx).toBe(44);
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
  });
});

describe('biến CSS sinh từ token', () => {
  it('phủ mọi màu, khoảng cách, bán kính, cỡ chữ và vùng chạm', () => {
    const css = tokensToCssVariables();
    expect(css).toContain(`--color-bg: ${color.bg};`);
    expect(css).toContain(`--color-focus: ${color.focus};`);
    expect(css).toContain(`--space-s4: ${space.s4};`);
    expect(css).toContain(`--radius-full: ${radius.full};`);
    expect(css).toContain(`--touch-target: ${touchTargetPx}px;`);
    for (const key of Object.keys(typography)) expect(css).toContain(`--text-${key}:`);
  });
});
