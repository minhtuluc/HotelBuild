'use client';
import type { ReactElement } from 'react';
import { space } from '@pinehill/ui-web';
import { OPS_COMPACT_BTN_STYLE, opsNoticeStyle } from '../../components/editorial-styles';
import type { Command, ControllerState, Phase } from './controller';
import { text } from './messages';
import type { Failure } from './model';

function failureText(failure: Failure): string {
  switch (failure.kind) {
    case 'overLimit':
      return text('overLimit');
    case 'conflict':
      return text('conflict');
    case 'inProgress':
      return text('inProgress', { seconds: failure.retryAfterSeconds });
    case 'keyReused':
      return text('keyReused');
    case 'ttl':
      return text('ttl');
    case 'unknown':
      return text('unknown');
    case 'forbidden':
      return text('forbidden');
    case 'validation':
      return text('rejected');
    default:
      return text('rejected');
  }
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
  if (command.kind === 'done')
    return (
      <p role="status" data-testid="hb132-done" style={opsNoticeStyle('success')}>
        {text('done')}
      </p>
    );
  const { failure, evidence } = command;
  const reference = evidence.traceId ?? evidence.code;
  return (
    <div role="alert" data-testid="hb132-failure" style={opsNoticeStyle('danger')}>
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
