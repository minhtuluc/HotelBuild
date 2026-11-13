'use client';
import type { CSSProperties, ReactElement } from 'react';
import { color, radius, space } from '@pinehill/ui-web';
import type { Command, ControllerState, Phase } from './controller';
import { text } from './messages';
import type { Failure } from './model';

type FailureKey = Parameters<typeof text>[0];

const FAILURE: Partial<Record<Failure['kind'], FailureKey>> = {
  conflict: 'conflict',
  deadlinePassed: 'deadlinePassed',
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

function noticeStyle(accent: string, background: string): CSSProperties {
  return {
    padding: `${space.s3}px ${space.s4}px`,
    background,
    border: `1px solid ${color.border}`,
    boxShadow: `inset 0 0 0 1px ${accent}`,
    borderRadius: radius.sm,
    display: 'grid',
    gap: space.s2,
    color: color.text,
  };
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
      <p role="status" style={{ ...noticeStyle(color.primary, color.surface), margin: 0 }}>
        {text('sending')}
      </p>
    );
  if (command.kind === 'done')
    return (
      <p
        role="status"
        data-testid="hb135-done"
        style={{
          ...noticeStyle(color.success, '#E7F3EE'),
          margin: 0,
          color: color.success,
          fontWeight: 500,
        }}
      >
        {text('done')}
      </p>
    );
  const { failure, evidence } = command;
  const reference = evidence.traceId ?? evidence.code;
  return (
    <div role="alert" data-testid="hb135-failure" style={noticeStyle(color.danger, '#FDF3F3')}>
      <p style={{ margin: 0, color: color.danger, fontWeight: 500 }}>{failureText(failure)}</p>
      {reference === undefined ? null : (
        <p style={{ margin: 0, fontSize: 13, color: color.textMuted }}>
          {text('reference', { reference })}
        </p>
      )}
      {pending ? (
        <div style={{ display: 'flex', gap: space.s2, flexWrap: 'wrap' }}>
          {failure.kind === 'ttl' ? null : (
            <button type="button" onClick={actions.retry} className="ph-btn-primary">
              {text('retry')}
            </button>
          )}
          <button type="button" onClick={actions.lookup} className="ph-btn">
            {text('lookup')}
          </button>
          <button type="button" onClick={actions.discard} className="ph-btn">
            {text('newIntent')}
          </button>
        </div>
      ) : null}
    </div>
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
      style={
        banner.alert
          ? noticeStyle(color.danger, '#FDF3F3')
          : noticeStyle(color.primary, color.surface)
      }
    >
      {text(banner.key)}
      {reference === undefined ? null : ` ${text('reference', { reference })}`}
    </div>
  );
}
