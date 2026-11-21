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

/**
 * HB-272 — vật liệu của thế giới vé tàu (DESIGN.md): giấy vé, bảng ga, đèn tín hiệu. Sao y `@pinehill/ui-web`.
 * Trên giấy vé hồng: chữ phụ dùng `ticketMuted`, đỏ hành động dùng `ticketPunch` (The Ticket Ink Rule).
 */
export const worldInk = {
  /** Nền giấy mẫu biểu nhà ga: nền màn phía khách. */
  ground: '#DFE5F0',
  ticket: '#F0C2B3',
  ticketLight: '#F6DCD3',
  ticketMuted: '#6B2F22',
  ticketPunch: '#962A16',
  board: '#121614',
  boardRow: '#1C221F',
  signal: '#F2B632',
  signalGo: '#7CD08A',
  punch: '#B8341C',
} as const;

/**
 * Họ chữ đóng gói offline (OFL, giống web): Be Vietnam Pro cho chữ thân, Barlow Condensed cho bảng ga/tiêu đề.
 * Android không tổng hợp `fontWeight` cho font tự nạp, nên mỗi độ đậm là một họ riêng — đừng đặt `fontWeight`.
 */
export const fontFamily = {
  sans: 'BeVietnamPro_400Regular',
  sansMedium: 'BeVietnamPro_500Medium',
  sansSemiBold: 'BeVietnamPro_600SemiBold',
  sansBold: 'BeVietnamPro_700Bold',
  display: 'BarlowCondensed_500Medium',
  displaySemiBold: 'BarlowCondensed_600SemiBold',
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
  display: { sp: 30, weight: '600' },
  h1: { sp: 24, weight: '600' },
  h2: { sp: 20, weight: '600' },
  body: { sp: 16, weight: '400' },
  sm: { sp: 14, weight: '400' },
  caption: { sp: 12, weight: '400' },
  money: { sp: 20, weight: '600', fontVariant: ['tabular-nums'] },
  /** Nhãn trường in trên vé (web 11px chữ hoa; native giữ sàn 12sp). */
  label: { sp: 12, weight: '700', letterSpacing: 0.8 },
  /** Chữ trên bảng ga: chữ hẹp, chữ hoa, số đều cột. */
  board: { sp: 20, weight: '600', fontVariant: ['tabular-nums'] },
} as const;

/** Khoảng cách và bán kính (§7.4); góc gần vuông như mép tem, giống web (HB-272). */
export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s6: 24, s8: 32, s10: 40, s12: 48 } as const;
export const radius = { sm: 3, md: 6, lg: 10, full: 999 } as const;

/** Vùng chạm tối thiểu 48 dp trên Android (UI-05). */
export const touchTargetDp = 48;

/** Hành động chính nằm ở 1/3 dưới màn hình; sheet trượt từ đáy (UI-04). */
export const primaryActionZone = 'bottom-third' as const;

/** Hành động chạm tay một ngón: cấm cử chỉ đa ngón cho nghiệp vụ (§9.3). */
export const allowMultiFingerGestures = false;
