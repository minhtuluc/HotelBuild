'use client';

/**
 * Khung xử lý lỗi và thiếu quyền (F0-04) theo phong cách Quiet Editorial.
 * `ErrorPanel` **không nhận** đối tượng lỗi nên không thể lộ stack trace hay chi tiết đối tượng;
 * chỉ nhận mã tham chiếu để người dùng gửi cho hỗ trợ.
 */
import type { CSSProperties, ReactElement } from 'react';
import { useTranslate } from './i18n.js';

const panelStyle: CSSProperties = {
  padding: 'var(--space-s6, 24px)',
  display: 'grid',
  gap: 'var(--space-s4, 16px)',
  backgroundColor: 'var(--color-surface, #FBFAF7)',
  color: 'var(--color-text, #1A1716)',
  border: '1px solid var(--color-danger, #9E1B32)',
  borderRadius: 'var(--radius-sm, 4px)',
  fontVariantNumeric: 'tabular-nums',
};

const headingStyle: CSSProperties = {
  fontFamily: "var(--font-sans, 'Be Vietnam Pro', system-ui, sans-serif)",
  fontSize: 'var(--text-h1, 24px)',
  fontWeight: 600,
  margin: 0,
  color: 'var(--color-text, #1A1716)',
};

/** Nút/link hành động của panel: class `.ph-btn-primary` của app; inline chỉ giữ vị trí và vùng chạm. */
const actionStyle: CSSProperties = {
  minHeight: 'var(--touch-target, 44px)',
  justifySelf: 'start',
};

export interface ErrorPanelProps {
  reset?: () => void;
  reference?: string | undefined;
}

export function ErrorPanel({ reset, reference }: ErrorPanelProps): ReactElement {
  const t = useTranslate();
  return (
    <section role="alert" data-testid="error-panel" style={panelStyle}>
      <h1 style={headingStyle}>{t('error.boundary.title')}</h1>
      <p style={{ margin: 0, color: 'var(--color-textMuted, #5A4640)' }}>
        {t('error.boundary.body')}
      </p>
      {reference === undefined ? null : (
        <p style={{ margin: 0 }}>
          <code
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 'var(--text-sm, 13px)',
              padding: '4px 8px',
              backgroundColor: 'var(--color-surfaceMuted, #E9E5DF)',
              borderRadius: 'var(--radius-sm, 4px)',
            }}
          >
            {reference}
          </code>
        </p>
      )}
      {reset === undefined ? null : (
        <button type="button" onClick={reset} className="ph-btn-primary" style={actionStyle}>
          {t('error.boundary.retry')}
        </button>
      )}
    </section>
  );
}

export interface AccessDeniedPanelProps {
  backHref?: string;
}

export function AccessDeniedPanel({ backHref = '/' }: AccessDeniedPanelProps): ReactElement {
  const t = useTranslate();
  return (
    <section role="alert" data-testid="access-denied" style={panelStyle}>
      <h1 style={headingStyle}>{t('access.denied.title')}</h1>
      <p style={{ margin: 0, color: 'var(--color-textMuted, #5A4640)' }}>
        {t('access.denied.body')}
      </p>
      <a href={backHref} className="ph-btn-primary" style={actionStyle}>
        {t('access.denied.back')}
      </a>
    </section>
  );
}
