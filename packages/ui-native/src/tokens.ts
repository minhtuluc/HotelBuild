/**
 * Design token Pine Hill (vé tàu) cho Android — đồng bộ màu với @pinehill/ui-web.
 * Bật `allowFontScaling` và chấp nhận thang chữ hệ thống tới 200% (§7.3).
 */

export const color = {
  bg: '#F3F2EE',
  surface: '#FBFAF7',
  surfaceMuted: '#E9E5DF',
  border: '#D9D2CC',
  borderStrong: '#6F625C',
  text: '#1A1716',
  textMuted: '#5A4640',
  primary: '#1B3A82',
  primaryContrast: '#FFFFFF',
  accent: '#B8341C',
  accentContrast: '#FFFFFF',
  dark: '#121614',
  darkText: '#F4EFE6',
  darkTextMuted: '#A9B3AC',
  danger: '#9E1B32',
  warning: '#8A4B06',
  success: '#17663A',
  info: '#1B3A82',
  focus: '#1B3A82',
} as const;

export type GridStatusKey =
  | 'available'
  | 'arriving'
  | 'inHouse'
  | 'departing'
  | 'held'
  | 'blocked'
  | 'dirty'
  | 'oversold'
  | 'otaClosed';

export interface GridStatusToken {
  symbol: string;
  background: string;
  text: string;
  dashedBorder?: string;
}

/** Chuẩn màu trạng thái ô lưới (UI-06). Ký hiệu chữ đi kèm màu. */
export const gridStatus: Record<GridStatusKey, GridStatusToken> = {
  available: { symbol: '·', background: '#E3F1EA', text: '#0D5A4A' },
  arriving: { symbol: '→', background: '#E2E9F6', text: '#1F3F7A' },
  inHouse: { symbol: 'Đ', background: '#D8E5F5', text: '#1F4E9A' },
  departing: { symbol: '←', background: '#F8ECD4', text: '#6B3A05' },
  held: { symbol: 'H', background: '#ECE6F5', text: '#3D3566' },
  blocked: { symbol: 'B', background: '#E8EAE3', text: '#343D39' },
  dirty: { symbol: 'D', background: '#F8E4E6', text: '#7F1730' },
  oversold: { symbol: '!', background: '#F7DCDC', text: '#8E1B1B' },
  otaClosed: {
    symbol: '*',
    background: '#FCFCF9',
    text: '#343D39',
    dashedBorder: color.borderStrong,
  },
};

/** Token chữ theo sp (§7.3). Cấm nhỏ hơn 12 sp; tiền không nhỏ hơn 14 sp. */
export const typography = {
  display: { sp: 30, weight: '500' },
  h1: { sp: 24, weight: '500' },
  h2: { sp: 20, weight: '500' },
  body: { sp: 16, weight: '400' },
  sm: { sp: 14, weight: '400' },
  caption: { sp: 12, weight: '400' },
  money: { sp: 20, weight: '500', fontVariant: ['tabular-nums'] },
} as const;

/** Khoảng cách và bán kính (§7.4). */
export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s6: 24, s8: 32, s10: 40, s12: 48 } as const;
export const radius = { sm: 4, md: 8, lg: 12, full: 999 } as const;

/** Vùng chạm tối thiểu 48 dp trên Android (UI-05). */
export const touchTargetDp = 48;

/** Hành động chính nằm ở 1/3 dưới màn hình; sheet trượt từ đáy (UI-04). */
export const primaryActionZone = 'bottom-third' as const;

/** Hành động chạm tay một ngón: cấm cử chỉ đa ngón cho nghiệp vụ (§9.3). */
export const allowMultiFingerGestures = false;
