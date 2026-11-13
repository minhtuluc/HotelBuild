/**
 * Design token Pine Hill — "vé tàu" (DESIGN.md, ADR-019 bản sửa 11/2026).
 * Giấy vé hồng in chìm + mực in xanh (#1B3A82) + dấu bấm đỏ (#B23A1A → #B8341C) + bảng ga đen chữ hổ phách.
 * Mọi cặp chữ/nền đều đạt tương phản WCAG 2.1 AA >= 4,5:1 (kiểm trong test/tokens.spec.ts).
 */

export const color = {
  /** Nền màn làm việc (trang trong, back-office): giấy trung tính hơi xám, không phải kem. */
  bg: '#F3F2EE',
  /** Bề mặt thẻ, bảng, form: giấy in. */
  surface: '#FBFAF7',
  surfaceMuted: '#E9E5DF',
  border: '#D9D2CC',
  borderStrong: '#6F625C',
  text: '#1A1716',
  textMuted: '#5A4640',
  /** Mực in xanh của vé: liên kết, hành động chính ở back-office, lựa chọn hiện tại. */
  primary: '#1B3A82',
  primaryContrast: '#FFFFFF',
  /** Dấu bấm đỏ: hành động chính phía khách (Tìm phòng, Giữ chỗ). */
  accent: '#B8341C',
  accentContrast: '#FFFFFF',
  /** Bảng ga: đầu/chân trang khách, thanh bên back-office. */
  dark: '#121614',
  darkText: '#F4EFE6',
  darkTextMuted: '#A9B3AC',
  danger: '#9E1B32',
  warning: '#8A4B06',
  success: '#17663A',
  info: '#1B3A82',
  /** Vòng tiêu điểm: xanh in đậm, khác đỏ hành động để luôn nhìn thấy. */
  focus: '#1B3A82',
} as const;

/**
 * Vật liệu của thế giới vé tàu: giấy vé, bảng ga, đèn tín hiệu. Dùng cho bề mặt lớn phía khách;
 * chữ trên giấy vé dùng `color.primary`/`color.text`; chữ phụ và đỏ trên giấy vé dùng `ticketMuted`/`ticketPunch`.
 */
export const worldInk = {
  /** Nền giấy mẫu biểu nhà ga: xanh xám nhạt, để vé hồng nổi lên (không dùng nền kem). */
  ground: '#DFE5F0',
  ticket: '#F0C2B3',
  ticketLight: '#F6DCD3',
  /** Chữ phụ và đỏ hành động khi nằm trên giấy vé hồng (đạt 6,4:1 và 4,95:1). */
  ticketMuted: '#6B2F22',
  ticketPunch: '#962A16',
  board: '#121614',
  boardRow: '#1C221F',
  signal: '#F2B632',
  signalGo: '#7CD08A',
  punch: '#B8341C',
} as const;

/** Họ chữ đóng gói offline (OFL): Be Vietnam Pro cho đoạn văn, Barlow Condensed cho bảng ga, tiêu đề, trường in trên vé. */
export const fontFamily = {
  display: "'Barlow Condensed', 'Arial Narrow', 'Be Vietnam Pro', system-ui, sans-serif",
  logo: "'Barlow Condensed', 'Arial Narrow', 'Be Vietnam Pro', system-ui, sans-serif",
  sans: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
} as const;

/** Vòng tiêu điểm bàn phím: viền 2 px + offset 2 px, không bao giờ `outline: none` (§9.2). */
export const focusRing = {
  outlineWidth: '2px',
  outlineOffset: '2px',
  outlineColor: color.focus,
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
  /** Ký hiệu chữ đi kèm màu — thông tin không được truyền đạt chỉ bằng màu (UI-06, UI-15). */
  symbol: string;
  background: string;
  text: string;
  dashedBorder?: string;
}

/** Chuẩn màu trạng thái ô lưới tồn phòng (UI-06, §7.2). */
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

/** Token chữ (§7.3). Cấm cỡ nhỏ hơn 12 px; số liệu tài chính không nhỏ hơn 14 px. Thang cố định 1,2. */
export const typography = {
  display: { web: '40px', lineHeight: 1.05, weight: 600 },
  h1: { web: '24px', lineHeight: 1.25, weight: 600 },
  h2: { web: '18px', lineHeight: 1.35, weight: 600 },
  body: { web: '15px', lineHeight: 1.55, weight: 400 },
  sm: { web: '13px', lineHeight: 1.45, weight: 400 },
  caption: { web: '12px', lineHeight: 1.4, weight: 500 },
  money: { web: '20px', lineHeight: 1.3, weight: 600, fontVariantNumeric: 'tabular-nums' },
} as const;

/** Token khoảng cách, bán kính, vùng chạm (§7.4). */
export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s6: 24,
  s8: 32,
  s10: 40,
  s12: 48,
} as const;

/** Góc gần vuông như mép tem; `md` cho hộp thoại và khối nổi. */
export const radius = { sm: 3, md: 6, lg: 10, full: 999 } as const;

/** Vùng chạm tối thiểu: 44 pt trên web (UI-05). */
export const touchTargetPx = 44;

/** Khoảng cách tối thiểu tới nút nguy hiểm như “Lưu” (UI-18). */
export const dangerousActionGapPx = space.s6;
