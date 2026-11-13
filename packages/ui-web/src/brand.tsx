/**
 * Biểu trưng Pine Hill: một tấm vé khuyết hai bên, lỗ bấm tròn, in chữ PH; cạnh wordmark chữ cạnh hẹp.
 * Dấu hiệu vẽ tay bằng SVG cho thế giới "tuyến Pine Hill"; không mượn tài sản thương hiệu bên ngoài.
 */
import type { ReactElement } from 'react';

export interface PineHillBrandProps {
  subtitle?: string;
  tone?: 'light' | 'dark';
  compact?: boolean;
}

const tonePalette = {
  light: {
    wordmark: 'var(--color-text, #1A1716)',
    ticket: 'var(--color-world-ticket, #F0C2B3)',
    print: 'var(--color-primary, #1B3A82)',
    punch: 'var(--color-accent, #B8341C)',
    subtitle: 'var(--color-textMuted, #5A4640)',
  },
  dark: {
    wordmark: 'var(--color-darkText, #F4EFE6)',
    ticket: 'var(--color-world-ticket, #F0C2B3)',
    print: 'var(--color-primary, #1B3A82)',
    punch: 'var(--color-accent, #B8341C)',
    subtitle: 'var(--color-darkTextMuted, #A9B3AC)',
  },
} as const;

const sizeScale = {
  standard: { mark: 30, gap: '10px', fontSize: '1.375rem' },
  compact: { mark: 26, gap: '8px', fontSize: '1.125rem' },
} as const;

function TicketMark({
  size,
  palette,
}: {
  size: number;
  palette: (typeof tonePalette)[keyof typeof tonePalette];
}): ReactElement {
  return (
    <svg
      width={(size * 44) / 30}
      height={size}
      viewBox="0 0 44 30"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <path
        d="M3 0 H41 A3 3 0 0 0 44 3 V11 A4 4 0 0 0 44 19 V27 A3 3 0 0 0 41 30 H3 A3 3 0 0 0 0 27 V19 A4 4 0 0 0 0 11 V3 A3 3 0 0 0 3 0 Z"
        fill={palette.ticket}
        stroke={palette.print}
        strokeWidth="1"
        strokeOpacity="0.55"
      />
      <path d="M31 4 V26" stroke={palette.print} strokeWidth="1.2" strokeDasharray="2 2" />
      <text
        x="16"
        y="20.5"
        textAnchor="middle"
        fontFamily="'Barlow Condensed', 'Arial Narrow', sans-serif"
        fontWeight="600"
        fontSize="15"
        fill={palette.print}
      >
        PH
      </text>
      <circle cx="37.5" cy="15" r="2.6" fill={palette.punch} />
    </svg>
  );
}

export function PineHillBrand({
  subtitle,
  tone = 'light',
  compact = false,
}: PineHillBrandProps): ReactElement {
  const palette = tonePalette[tone];
  const scale = compact ? sizeScale.compact : sizeScale.standard;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: scale.gap }}>
      <TicketMark size={scale.mark} palette={palette} />
      <span style={{ display: 'inline-grid', gap: 2 }}>
        <span
          style={{
            fontFamily: "var(--font-logo, 'Barlow Condensed', 'Arial Narrow', sans-serif)",
            fontWeight: 600,
            fontSize: scale.fontSize,
            lineHeight: 1,
            letterSpacing: '0.06em',
            color: palette.wordmark,
          }}
        >
          PINE HILL
        </span>
        {subtitle === undefined ? null : (
          <span
            style={{
              fontFamily: "var(--font-sans, 'Be Vietnam Pro', system-ui, sans-serif)",
              fontSize: '12px',
              fontWeight: 500,
              lineHeight: 1.2,
              color: palette.subtitle,
            }}
          >
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}
