'use client';
import type { ReactElement } from 'react';
import type { Command, ControllerState, Phase } from './controller';
import { text } from './messages';
import type { Failure } from './model';

type Key = Parameters<typeof text>[0];

const FAILURE: Partial<Record<Failure['kind'], Key>> = {
  conflict: 'conflict',
  roomTaken: 'roomTaken',
  noConsent: 'noConsent',
  mergeGender: 'mergeGender',
  approvalRequired: 'approvalRequired',
  moveNotAllowed: 'moveNotAllowed',
  pinRequired: 'pinRequired',
  pinLocked: 'pinLocked',
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

const BUTTON = { minHeight: 44 } as const;

/** Kết quả của lệnh vừa gửi; chưa rõ kết quả thì chỉ cho tra theo khoá, gửi lại đúng lệnh cũ hoặc bỏ có chủ đích. */
export function CommandStatus({
  command,
  pending,
  intentState,
  actions,
}: {
  command: Command;
  pending: boolean;
  intentState: string | null;
  actions: StatusActions;
}): ReactElement | null {
  if (command.kind === 'idle') return null;
  if (command.kind === 'sending') return <p role="status">{text('sending')}</p>;
  if (command.kind === 'done')
    return (
      <p role="status" data-testid="hb137-done">
        {text('done')}
      </p>
    );
  const { failure, evidence } = command;
  const reference = evidence.traceId ?? evidence.code;
  return (
    <div role="alert" data-testid="hb137-failure" style={{ display: 'grid', gap: 8 }}>
      <p>{failureText(failure)}</p>
      {reference === undefined ? null : <p>{text('reference', { reference })}</p>}
      {intentState === null ? null : <p>{text('intentState', { state: intentState })}</p>}
      {pending ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {failure.kind === 'ttl' ? null : (
            <button type="button" onClick={actions.retry} style={BUTTON}>
              {text('retry')}
            </button>
          )}
          <button type="button" onClick={actions.lookup} style={BUTTON}>
            {text('lookup')}
          </button>
          <button type="button" onClick={actions.discard} style={BUTTON}>
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

/** Băng trạng thái đọc: dữ liệu cũ được giữ nguyên, lỗi không biến thành trang trống. */
export function ReadBanner({ state }: { state: ControllerState }): ReactElement | null {
  const banner = BANNER[state.phase];
  if (banner === undefined) return null;
  const reference = state.evidence?.traceId ?? state.evidence?.code;
  return (
    <div role={banner.alert ? 'alert' : 'status'} aria-live="polite" aria-busy={banner.busy}>
      {text(banner.key)}
      {reference === undefined ? null : ` ${text('reference', { reference })}`}
    </div>
  );
}
