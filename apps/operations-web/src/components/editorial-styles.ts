import type { CSSProperties } from 'react';
import { color, fontFamily, radius, space, typography } from '@pinehill/ui-web';

export type NoticeTone = 'danger' | 'warning' | 'success' | 'info' | 'neutral';

export const OPS_PAGE_STYLE: CSSProperties = {
  maxWidth: 1400,
  marginInline: 'auto',
  padding: `clamp(${space.s4}px, 3vw, ${space.s6}px)`,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: space.s4,
  minWidth: 0,
};

export const OPS_HEADER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: space.s3,
  justifyContent: 'space-between',
  alignItems: 'center',
};

export const OPS_HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: space.s1,
};

/** Tiêu đề màn vận hành: cùng họ chữ với nội dung (không dùng chữ trưng bày ở công cụ làm việc). */
export const OPS_TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontFamily: fontFamily.sans,
  fontSize: typography.h1.web,
  lineHeight: typography.h1.lineHeight,
  fontWeight: typography.h1.weight,
  letterSpacing: '-0.01em',
  color: color.text,
};

export const OPS_SUBTITLE_STYLE: CSSProperties = {
  margin: 0,
  fontFamily: fontFamily.sans,
  fontSize: typography.h2.web,
  lineHeight: typography.h2.lineHeight,
  fontWeight: typography.h2.weight,
  color: color.text,
};

export const OPS_INTRO_STYLE: CSSProperties = {
  margin: 0,
  color: color.textMuted,
  maxWidth: '58rem',
};

export const OPS_FILTER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: space.s3,
  flexWrap: 'wrap',
  alignItems: 'end',
  padding: space.s4,
  minWidth: 0,
};

export const OPS_FIELD_LABEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 13,
  fontWeight: 500,
  color: color.text,
  minWidth: 0,
};

export const OPS_TABLE_WRAP_STYLE: CSSProperties = {
  overflowX: 'auto',
  maxWidth: '100%',
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
};

/**
 * Giữ lại để không phải sửa ~90 chỗ gọi: cỡ chữ, đệm và chiều cao nút nay do class `.ph-btn*` quyết định
 * (globals.css), nút trong ô bảng tự gọn lại. Ở đây chỉ còn phần chống tràn cột.
 */
export const OPS_COMPACT_BTN_STYLE: CSSProperties = {
  maxWidth: '100%',
  overflowWrap: 'anywhere',
};

export const OPS_TABULAR_STYLE: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
};

export const OPS_DIALOG_STYLE: CSSProperties = {
  width: 'min(480px, calc(100vw - 32px))',
  maxWidth: 'calc(100vw - 32px)',
  margin: 'auto',
  background: color.surface,
  color: color.text,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  padding: space.s6,
  boxSizing: 'border-box',
};

/** Nền nhạt cùng sắc với viền 1px của từng mức; mức được nói bằng chữ trong nội dung, không chỉ bằng màu. */
const NOTICE_THEME: Readonly<Record<NoticeTone, { bg: string; accent: string }>> = {
  danger: { bg: '#FBEFF1', accent: color.danger },
  warning: { bg: '#FBF3E6', accent: color.warning },
  success: { bg: '#E9F3ED', accent: color.success },
  info: { bg: '#ECF1FA', accent: color.info },
  neutral: { bg: color.surface, accent: color.border },
};

export function opsNoticeStyle(tone: NoticeTone): CSSProperties {
  const theme = NOTICE_THEME[tone];
  return {
    margin: 0,
    padding: `${space.s3}px ${space.s4}px`,
    background: theme.bg,
    border: `1px solid ${theme.accent}`,
    borderRadius: radius.sm,
    color: color.text,
    display: 'grid',
    gap: space.s2,
  };
}
