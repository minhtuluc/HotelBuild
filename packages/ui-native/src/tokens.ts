/**
 * Design token cho Android — bản chép trung thành của
 * docs/04-thiet-ke/thiet-ke-man-hinh.md §7 (cột Android).
 * Bật `allowFontScaling` và chấp nhận thang chữ hệ thống tới 200% (§7.3).
 */

export const color = {
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  border: '#E5E7EB',
  borderStrong: '#6B7280',
  text: '#111827',
  textMuted: '#4B5563',
  primary: '#0F766E',
  danger: '#B91C1C',
  warning: '#B45309',
  success: '#15803D',
  info: '#1D4ED8',
  focus: '#1D4ED8',
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
  available: { symbol: '·', background: '#ECFDF5', text: '#065F46' },
  arriving: { symbol: '→', background: '#E0E7FF', text: '#312E81' },
  inHouse: { symbol: 'Đ', background: '#DBEAFE', text: '#1E3A8A' },
  departing: { symbol: '←', background: '#FEF3C7', text: '#78350F' },
  held: { symbol: 'H', background: '#F3E8FF', text: '#4C1D95' },
  blocked: { symbol: 'B', background: '#E5E7EB', text: '#374151' },
  dirty: { symbol: 'D', background: '#FFE4E6', text: '#881337' },
  oversold: { symbol: '!', background: '#FEE2E2', text: '#991B1B' },
  otaClosed: { symbol: '*', background: '#FFFFFF', text: '#374151', dashedBorder: '#6B7280' },
};

/** Token chữ theo sp (§7.3). Cấm nhỏ hơn 12 sp; tiền không nhỏ hơn 14 sp. */
export const typography = {
  display: { sp: 30, weight: '700' },
  h1: { sp: 24, weight: '700' },
  h2: { sp: 20, weight: '600' },
  body: { sp: 16, weight: '400' },
  sm: { sp: 14, weight: '400' },
  caption: { sp: 12, weight: '400' },
  money: { sp: 20, weight: '600', fontVariant: ['tabular-nums'] },
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
