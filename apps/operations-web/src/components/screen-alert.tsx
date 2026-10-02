'use client';

/**
 * Băng lỗi cho lỗi khi **đọc** dữ liệu. Chỉ nhận đối tượng lỗi đã chuẩn hoá và hiện mã lỗi,
 * hành động gợi ý và mã tra cứu — không hiện `message` hay chi tiết kỹ thuật của server.
 */
import type { ReactElement } from 'react';
import { isApiError } from '@pinehill/api-client';
import { actionMessageKey, mapErrorToUiAction, waitMessage } from '@pinehill/ui-web';
import { t } from '../lib/i18n';

export interface ScreenAlertProps {
  error: unknown;
  onRetry: () => void;
}

function RetryButton({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <button type="button" onClick={onRetry} style={{ minHeight: 44 }}>
      {t('screen.alert.retry')}
    </button>
  );
}

export function ScreenAlert({ error, onRetry }: ScreenAlertProps): ReactElement {
  const style = {
    margin: 0,
    padding: 'var(--space-s4, 16px)',
    border: '1px solid var(--color-danger)',
    display: 'grid',
    gap: 'var(--space-s2, 8px)',
    justifyItems: 'start',
  } as const;
  if (!isApiError(error)) {
    return (
      <p role="alert" data-testid="screen-alert" style={style}>
        <span>{t('screen.alert.failed', { code: 'UNKNOWN' })}</span>
        <RetryButton onRetry={onRetry} />
      </p>
    );
  }
  const known = error.knownCode;
  const wait =
    known === undefined || error.retryAfterSeconds === undefined
      ? undefined
      : waitMessage(known, error.retryAfterSeconds);
  const reference = error.traceId ?? error.correlationId;
  return (
    <p role="alert" data-testid="screen-alert" style={style}>
      <span>{t('screen.alert.failed', { code: known ?? error.kind })}</span>
      <span>
        {t(actionMessageKey(mapErrorToUiAction({ code: error.code, status: error.status })))}
      </span>
      {wait === undefined ? null : <span>{wait}</span>}
      {reference === undefined ? null : <code>{reference}</code>}
      <RetryButton onRetry={onRetry} />
    </p>
  );
}
