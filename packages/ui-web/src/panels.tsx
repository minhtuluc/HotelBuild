'use client';

/**
 * Khung xử lý lỗi và thiếu quyền (F0-04).
 * `ErrorPanel` **không nhận** đối tượng lỗi nên không thể lộ stack trace hay chi tiết đối tượng;
 * chỉ nhận mã tham chiếu để người dùng gửi cho hỗ trợ.
 */
import type { ReactElement } from 'react';
import { useTranslate } from './i18n.js';

export interface ErrorPanelProps {
  reset?: () => void;
  reference?: string | undefined;
}

export function ErrorPanel({ reset, reference }: ErrorPanelProps): ReactElement {
  const t = useTranslate();
  return (
    <section
      role="alert"
      data-testid="error-panel"
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ fontSize: 'var(--text-h1, 24px)', margin: 0 }}>{t('error.boundary.title')}</h1>
      <p style={{ margin: 0 }}>{t('error.boundary.body')}</p>
      {reference === undefined ? null : (
        <p style={{ margin: 0 }}>
          <code>{reference}</code>
        </p>
      )}
      {reset === undefined ? null : (
        <button type="button" onClick={reset} style={{ minHeight: 44, justifySelf: 'start' }}>
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
    <section
      role="alert"
      data-testid="access-denied"
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ fontSize: 'var(--text-h1, 24px)', margin: 0 }}>{t('access.denied.title')}</h1>
      <p style={{ margin: 0 }}>{t('access.denied.body')}</p>
      <a href={backHref} style={{ minHeight: 44, alignSelf: 'start' }}>
        {t('access.denied.back')}
      </a>
    </section>
  );
}
