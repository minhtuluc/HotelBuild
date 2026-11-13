'use client';

/**
 * Băng lỗi cho lỗi khi **đọc** dữ liệu. Chỉ nhận đối tượng lỗi đã chuẩn hoá và hiện mã lỗi,
 * hành động gợi ý và mã tra cứu — không hiện `message` hay chi tiết kỹ thuật của server.
 * Hỗ trợ trạng thái quá tải 503 / `E_GEN_SERVICE_UNAVAILABLE` (TD-41).
 */
import type { CSSProperties, ReactElement } from 'react';
import { isApiError, type ApiError } from '@pinehill/api-client';
import {
  actionMessageKey,
  color,
  mapErrorToUiAction,
  radius,
  space,
  waitMessage,
} from '@pinehill/ui-web';
import { t } from '../lib/i18n';
import { isServiceUnavailable } from '../lib/screen-state';

export interface ScreenAlertProps {
  error: unknown;
  onRetry: () => void;
}

function alertStyle(overloaded: boolean): CSSProperties {
  return {
    margin: 0,
    padding: `${space.s3}px ${space.s4}px`,
    background: overloaded ? '#FDF8EF' : '#FDF3F3',
    border: `1px solid ${color.border}`,
    boxShadow: `inset 0 0 0 1px ${overloaded ? color.warning : color.danger}`,
    borderRadius: radius.sm,
    color: color.text,
    display: 'grid',
    gap: space.s2,
    justifyItems: 'start',
  };
}

function RetryButton({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <button type="button" onClick={onRetry} className="ph-btn">
      {t('screen.alert.retry')}
    </button>
  );
}

function overloadRetryNotice(error: ApiError): string | undefined {
  const seconds = error.retryAfterSeconds;
  if (seconds === undefined) return undefined;
  if (seconds >= 60) {
    return t('screen.alert.retryAfterMinutes', { minutes: Math.max(1, Math.ceil(seconds / 60)) });
  }
  return t('screen.alert.retryAfterSeconds', { seconds: Math.max(1, Math.ceil(seconds)) });
}

function apiWaitNotice(error: ApiError): string | undefined {
  if (isServiceUnavailable(error)) return overloadRetryNotice(error);
  const known = error.knownCode;
  if (known === undefined || error.retryAfterSeconds === undefined) return undefined;
  return waitMessage(known, error.retryAfterSeconds);
}

export function ScreenAlert({ error, onRetry }: ScreenAlertProps): ReactElement {
  if (!isApiError(error)) {
    return (
      <div role="alert" data-testid="screen-alert" style={alertStyle(false)}>
        <span style={{ fontWeight: 500, color: color.danger }}>
          {t('screen.alert.failed', { code: 'UNKNOWN' })}
        </span>
        <RetryButton onRetry={onRetry} />
      </div>
    );
  }
  const overloaded = isServiceUnavailable(error);
  const known = error.knownCode;
  const codeLabel = known ?? (overloaded ? 'E_GEN_SERVICE_UNAVAILABLE' : error.kind);
  const wait = apiWaitNotice(error);
  const reference = error.traceId ?? error.correlationId;
  return (
    <div role="alert" data-testid="screen-alert" style={alertStyle(overloaded)}>
      <span style={{ fontWeight: 500, color: overloaded ? color.warning : color.danger }}>
        {t('screen.alert.failed', { code: codeLabel })}
      </span>
      <span>
        {overloaded
          ? t('screen.alert.overloaded')
          : t(actionMessageKey(mapErrorToUiAction({ code: error.code, status: error.status })))}
      </span>
      {wait === undefined ? null : (
        <span style={{ fontSize: 13, color: color.textMuted, fontVariantNumeric: 'tabular-nums' }}>
          {wait}
        </span>
      )}
      {reference === undefined ? null : (
        <code style={{ fontSize: 12, color: color.textMuted }}>{reference}</code>
      )}
      <RetryButton onRetry={onRetry} />
    </div>
  );
}
