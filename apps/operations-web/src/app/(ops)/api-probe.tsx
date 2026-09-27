'use client';

/**
 * Smoke tích hợp tối thiểu của F0-08: shell gọi API thật qua `@pinehill/api-client`
 * (không cần nghiệp vụ F1). Trạng thái hiển thị đi theo hợp đồng 9 trạng thái.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { ApiClient, isApiError } from '@pinehill/api-client';
import {
  actionMessageKey,
  mapErrorToUiAction,
  StateSurface,
  useTranslate,
  type UiAction,
} from '@pinehill/ui-web';

type ProbeState =
  | { kind: 'loading' }
  | { kind: 'ok' }
  | { kind: 'forbidden' }
  | { kind: 'failed'; code: string; action: UiAction; reference: string | undefined };

export function ApiProbe({ baseUrl }: { baseUrl: string }): ReactElement {
  const t = useTranslate();
  const [state, setState] = useState<ProbeState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const client = new ApiClient({ baseUrl, maxAttempts: 2 });
    client
      .requestVoid({ method: 'GET', path: '/system/health' })
      .then(() => {
        if (!cancelled) setState({ kind: 'ok' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (!isApiError(error)) {
          setState({
            kind: 'failed',
            code: 'UNKNOWN',
            action: 'contact-support',
            reference: undefined,
          });
          return;
        }
        const action = mapErrorToUiAction({ code: error.code, status: error.status });
        if (action === 'request-access') {
          setState({ kind: 'forbidden' });
          return;
        }
        setState({
          kind: 'failed',
          code: error.knownCode ?? error.kind,
          action,
          reference: error.traceId ?? error.correlationId,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  if (state.kind === 'loading') return <StateSurface state={{ kind: 'loading' }} />;
  if (state.kind === 'forbidden') {
    return (
      <div data-testid="api-probe-forbidden">
        <StateSurface state={{ kind: 'forbidden' }} />
      </div>
    );
  }
  if (state.kind === 'ok') {
    return (
      <p data-testid="api-probe-ok" role="status" style={{ margin: 0 }}>
        {t('api.probe.ok')} · <code>{baseUrl}</code>
      </p>
    );
  }
  return (
    <p data-testid="api-probe-error" role="alert" style={{ margin: 0 }}>
      {t('api.probe.failed', { code: state.code })} · {t(actionMessageKey(state.action))}
      {state.reference === undefined ? null : <span> · {state.reference}</span>}
    </p>
  );
}
