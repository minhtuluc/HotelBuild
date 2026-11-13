'use client';
import type { ReactElement } from 'react';
import { space } from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_SUBTITLE_STYLE,
  opsNoticeStyle,
} from '../../components/editorial-styles';
import type { Command, ControllerState, Phase, Tracked } from './controller';
import { text } from './messages';
import type { Failure } from './model';

type FailureKey = Parameters<typeof text>[0];

const FAILURE: Partial<Record<Failure['kind'], FailureKey>> = {
  syncFailed: 'syncFailed',
  conflict: 'conflict',
  keyReused: 'keyReused',
  ttl: 'ttl',
  unknown: 'unknown',
  forbidden: 'forbidden',
};

function failureText(failure: Failure): string {
  if (failure.kind === 'inProgress')
    return text('inProgress', { seconds: failure.retryAfterSeconds });
  return text(FAILURE[failure.kind] ?? 'rejected');
}

export interface StatusActions {
  retry: () => void;
  lookup: () => void;
  discard: () => void;
}

/** Kết quả của lệnh vừa gửi; chưa rõ kết quả thì chỉ cho gửi lại đúng lệnh cũ hoặc đối soát. */
export function CommandStatus({
  command,
  pending,
  actions,
}: {
  command: Command;
  pending: boolean;
  actions: StatusActions;
}): ReactElement | null {
  if (command.kind === 'idle') return null;
  if (command.kind === 'sending')
    return (
      <p role="status" style={opsNoticeStyle('info')}>
        {text('sending')}
      </p>
    );
  const { failure, evidence } = command;
  const reference = evidence.traceId ?? evidence.code;
  return (
    <div role="alert" data-testid="hb133-failure" style={opsNoticeStyle('danger')}>
      <p style={{ margin: 0, fontWeight: 500 }}>{failureText(failure)}</p>
      {reference === undefined ? null : (
        <p style={{ margin: 0, fontSize: 13 }}>{text('reference', { reference })}</p>
      )}
      {pending ? (
        <div style={{ display: 'flex', gap: space.s2, flexWrap: 'wrap' }}>
          {failure.kind === 'ttl' ? null : (
            <button
              type="button"
              className="ph-btn-primary"
              onClick={actions.retry}
              style={OPS_COMPACT_BTN_STYLE}
            >
              {text('retry')}
            </button>
          )}
          <button
            type="button"
            className="ph-btn"
            onClick={actions.lookup}
            style={OPS_COMPACT_BTN_STYLE}
          >
            {text('lookup')}
          </button>
          <button
            type="button"
            className="ph-btn"
            onClick={actions.discard}
            style={OPS_COMPACT_BTN_STYLE}
          >
            {text('newIntent')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const OP_TEXT = {
  PENDING: 'opPending',
  RUNNING: 'opRunning',
  SUCCEEDED: 'opSucceeded',
  FAILED: 'opFailed',
} as const;

/** Tác vụ 202: "chờ/đang chạy" không bao giờ được gọi là đã đồng bộ; chỉ SUCCEEDED của máy chủ mới là xong. */
export function OperationPanel({
  operation,
  onCheck,
  onRetry,
  canRetry,
}: {
  operation: Tracked | null;
  onCheck: () => void;
  onRetry: () => void;
  canRetry: boolean;
}): ReactElement | null {
  if (operation === null) return null;
  const failed = operation.status === 'FAILED';
  return (
    <section
      aria-labelledby="hb133-op-title"
      data-testid="hb133-operation"
      className="ph-card"
      style={{ display: 'grid', gap: space.s2, padding: space.s4 }}
    >
      <h2 id="hb133-op-title" style={OPS_SUBTITLE_STYLE}>
        {text('opTitle')}
      </h2>
      <p role="status" aria-live="polite" style={{ margin: 0 }}>
        {operation.lost ? text('opUnknown') : text(OP_TEXT[operation.status])}
      </p>
      <p style={{ margin: 0 }}>{text('opId', { id: operation.id })}</p>
      {failed && operation.errorCode !== undefined ? (
        <p style={{ margin: 0 }}>{text('reference', { reference: operation.errorCode })}</p>
      ) : null}
      {operation.lost ? (
        <button
          type="button"
          className="ph-btn"
          onClick={onCheck}
          style={{ ...OPS_COMPACT_BTN_STYLE, justifySelf: 'start' }}
        >
          {text('check')}
        </button>
      ) : null}
      {failed && canRetry ? (
        <button
          type="button"
          className="ph-btn-primary"
          onClick={onRetry}
          style={{ ...OPS_COMPACT_BTN_STYLE, justifySelf: 'start' }}
        >
          {text('retrySync')}
        </button>
      ) : null}
    </section>
  );
}

interface Banner {
  key: 'loading' | 'refreshing' | 'offline' | 'serverError';
  alert: boolean;
  busy: boolean;
}

const BANNER: Partial<Record<Phase, Banner>> = {
  loading: { key: 'loading', alert: false, busy: true },
  refreshing: { key: 'refreshing', alert: false, busy: true },
  offline: { key: 'offline', alert: true, busy: false },
  error: { key: 'serverError', alert: true, busy: false },
};

/** Băng trạng thái đọc: dữ liệu cũ được giữ nguyên, lỗi không biến thành danh sách rỗng. */
export function ReadBanner({ state }: { state: ControllerState }): ReactElement | null {
  const banner = BANNER[state.phase];
  if (banner === undefined) return null;
  const reference = state.evidence?.traceId ?? state.evidence?.code;
  return (
    <div
      role={banner.alert ? 'alert' : 'status'}
      aria-live="polite"
      aria-busy={banner.busy}
      style={opsNoticeStyle(banner.alert ? 'danger' : 'info')}
    >
      {text(banner.key)}
      {reference === undefined ? null : ` ${text('reference', { reference })}`}
    </div>
  );
}
