import { describe, expect, it } from 'vitest';
import {
  boardRowStyle,
  boardStyle,
  buttonStyle,
  fieldStyle,
  labelStyle,
  moneyStyle,
  ticketStyle,
  type ButtonRole,
} from '../src/components/styles.js';
import { color, worldInk } from '../src/tokens.js';

function luminance(hex: string): number {
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(hex.replace('#', '').slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
const ROLES: readonly ButtonRole[] = ['accent', 'primary', 'outline', 'danger'];
const hex = (value: unknown): string => (typeof value === 'string' ? value : '#000000');

describe('HB-272 Button', () => {
  it('dấu bấm đỏ; trên giấy vé đổi sang đỏ đậm', () => {
    expect(buttonStyle({ role: 'accent' }).container.backgroundColor).toBe(worldInk.punch);
    expect(buttonStyle({ role: 'accent', onTicket: true }).container.backgroundColor).toBe(
      worldInk.ticketPunch,
    );
    expect(buttonStyle({ role: 'primary' }).container.backgroundColor).toBe(color.primary);
  });

  it('hai cỡ 48 và 56 dp', () => {
    expect(buttonStyle({ role: 'primary' }).container.minHeight).toBe(48);
    expect(buttonStyle({ role: 'accent', size: 'lg' }).container.minHeight).toBe(56);
  });

  it('không bấm được: nền giấy xám, chữ mực phụ, không dùng opacity', () => {
    for (const role of ROLES) {
      const style = buttonStyle({ role, disabled: true });
      expect(style.container.backgroundColor).toBe(color.surfaceMuted);
      expect(style.container.borderColor).toBe(color.border);
      expect(style.label.color).toBe(color.textMuted);
      expect(style.container.opacity).toBeUndefined();
    }
  });

  it('nhấn thì xuống 1dp', () => {
    expect(buttonStyle({ role: 'primary', pressed: true }).container.transform).toEqual([
      { translateY: 1 },
    ]);
  });

  it('mọi vai đạt tương phản AA', () => {
    for (const role of ROLES)
      for (const onTicket of [false, true]) {
        const style = buttonStyle({ role, onTicket });
        const background = hex(
          style.container.backgroundColor === 'transparent'
            ? onTicket
              ? worldInk.ticket
              : color.surface
            : style.container.backgroundColor,
        );
        expect(
          contrast(hex(style.label.color), background),
          `${role}/${onTicket}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
  });
});

describe('HB-272 giấy vé, bảng ga, ô nhập', () => {
  it('giấy vé hồng, đầu kẻ đôi mực xanh, có bóng giấy', () => {
    const style = ticketStyle();
    expect(style.backgroundColor).toBe(worldInk.ticket);
    expect(style.borderTopColor).toBe(color.primary);
    expect(style.borderTopWidth).toBe(3);
  });

  it('chữ trên giấy vé theo quy tắc Ticket Ink', () => {
    expect(labelStyle(true).color).toBe(worldInk.ticketMuted);
    expect(labelStyle(false).color).toBe(color.textMuted);
    expect(contrast(worldInk.ticketMuted, worldInk.ticket)).toBeGreaterThanOrEqual(4.5);
    expect(moneyStyle(true).fontVariant).toEqual(['tabular-nums']);
  });

  it('bảng ga đen chữ hổ phách, hàng chọn xanh còn chỗ', () => {
    expect(boardStyle().container.backgroundColor).toBe(worldInk.board);
    expect(boardStyle().title.color).toBe(worldInk.signal);
    expect(boardRowStyle(false).label.color).toBe(color.darkText);
    expect(boardRowStyle(true).label.color).toBe(worldInk.signalGo);
    expect(boardRowStyle(false).container.minHeight).toBeGreaterThanOrEqual(48);
    for (const ink of [worldInk.signal, worldInk.signalGo, color.darkText])
      expect(contrast(ink, worldInk.board)).toBeGreaterThanOrEqual(4.5);
  });

  it('ô nhập viền mực xanh, tiêu điểm 2dp, lỗi đỏ', () => {
    expect(fieldStyle({}).borderWidth).toBe(1.5);
    expect(fieldStyle({ focused: true }).borderWidth).toBe(2);
    expect(fieldStyle({ invalid: true }).borderColor).toBe(color.danger);
    expect(fieldStyle({}).minHeight).toBeGreaterThanOrEqual(48);
  });
});
