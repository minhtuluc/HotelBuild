import { describe, expect, it } from 'vitest';
import { createTheme } from '../src/theme.js';
import { color, fontFamily, worldInk } from '../src/tokens.js';

/** Khoá `theme` hai app đang dùng trước HB-272 — phải còn đủ để mọi màn tự đổi giao diện. */
const LEGACY_KEYS = [
  'screen',
  'scroll',
  'scrollContent',
  'card',
  'cardMuted',
  'hairline',
  'divider',
  'field',
  'buttonPrimary',
  'buttonPrimaryText',
  'buttonSecondary',
  'buttonSecondaryText',
  'buttonDanger',
  'buttonPlain',
  'buttonPlainText',
  'title',
  'sectionTitle',
  'body',
  'muted',
  'caption',
  'tabular',
  'money',
  'moneyInline',
  'alertDanger',
  'alertWarning',
  'alertSuccess',
];

describe('HB-272 createTheme', () => {
  it('hai mặt có cùng tập khoá, bao trọn khoá cũ và thêm ticket/label/board', () => {
    const guest = Object.keys(createTheme('guest').theme).sort();
    const ops = Object.keys(createTheme('ops').theme).sort();
    expect(guest).toEqual(ops);
    for (const key of [
      ...LEGACY_KEYS,
      'ticket',
      'label',
      'board',
      'buttonAccent',
      'buttonAccentText',
    ])
      expect(guest).toContain(key);
  });

  it('khách: nền mẫu biểu, header bảng ga chữ hổ phách; dấu bấm đỏ chỉ cho bước cam kết', () => {
    const { theme, stackScreenOptions, tabScreenOptions } = createTheme('guest');
    expect(theme.screen.backgroundColor).toBe(worldInk.ground);
    // DESIGN.md: nút tiện ích phía khách (tra cứu, đăng nhập, lọc) là mực in; cam kết là dấu bấm.
    expect(theme.buttonPrimary.backgroundColor).toBe(color.primary);
    expect(theme.buttonAccent.backgroundColor).toBe(worldInk.punch);
    expect(theme.buttonAccentText.color).toBe(color.accentContrast);
    expect(theme.title.fontFamily).toBe(fontFamily.displaySemiBold);
    expect(stackScreenOptions.headerStyle.backgroundColor).toBe(worldInk.board);
    expect(stackScreenOptions.headerTintColor).toBe(worldInk.signal);
    expect(tabScreenOptions.tabBarStyle.backgroundColor).toBe(worldInk.board);
    expect(tabScreenOptions.tabBarActiveTintColor).toBe(worldInk.signal);
  });

  it('vận hành: nền làm việc, nút chính mực xanh, tiêu đề chữ thân', () => {
    const { theme, stackScreenOptions } = createTheme('ops');
    expect(theme.screen.backgroundColor).toBe(color.bg);
    expect(theme.buttonPrimary.backgroundColor).toBe(color.primary);
    expect(theme.title.fontFamily).toBe(fontFamily.sansSemiBold);
    expect(stackScreenOptions.headerStyle.backgroundColor).toBe(worldInk.board);
    expect(stackScreenOptions.headerTintColor).toBe(color.darkText);
  });

  it('nút nguy hiểm là kiểu viền như web; chữ không đặt fontWeight', () => {
    const { theme } = createTheme('guest');
    expect(theme.buttonDanger.borderColor).toBe(color.danger);
    expect(theme.buttonDanger.backgroundColor).toBe(color.surface);
    for (const value of Object.values(theme)) expect(value).not.toHaveProperty('fontWeight');
  });
});
