/**
 * Design token — bản chép trung thành của docs/04-thiet-ke/thiet-ke-man-hinh.md §7.
 * Chỉ phát hành chế độ sáng; tên token theo vai trò để có thể thêm chế độ tối sau.
 * Đổi giá trị ở đây phải đổi tài liệu gốc trước.
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

/** Token chữ (§7.3). Cấm cỡ nhỏ hơn 12 px; số liệu tài chính không nhỏ hơn 14 px. */
export const typography = {
  display: { web: '32px', lineHeight: 1.25, weight: 700 },
  h1: { web: '24px', lineHeight: 1.3, weight: 700 },
  h2: { web: '18px', lineHeight: 1.4, weight: 600 },
  body: { web: '15px', lineHeight: 1.5, weight: 400 },
  sm: { web: '13px', lineHeight: 1.4, weight: 400 },
  caption: { web: '12px', lineHeight: 1.35, weight: 400 },
  money: { web: '20px', lineHeight: 1.4, weight: 600, fontVariantNumeric: 'tabular-nums' },
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

export const radius = { sm: 4, md: 8, lg: 12, full: 999 } as const;

/** Vùng chạm tối thiểu: 44 pt trên web (UI-05). */
export const touchTargetPx = 44;

/** Khoảng cách tối thiểu tới nút nguy hiểm như “Lưu” (UI-18). */
export const dangerousActionGapPx = space.s6;
