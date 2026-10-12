import type { ReactElement } from 'react';
import type { SettingsController, SettingsState } from './controller';
import { auditLogHref } from '../../../lib/system-settings';
import { settingsText as text } from './messages-session';
function ConflictStatus({
  state,
  controller,
}: {
  state: SettingsState;
  controller: SettingsController | null;
}): ReactElement | null {
  const row = state.rows.find((r) => r.key === state.draft?.key);
  return (
    <div role="alert" data-testid="setting-conflict" style={{ display: 'grid', gap: 8 }}>
      <p>{text('conflict', { version: state.draft?.version ?? '' })}</p>
      <button
        type="button"
        disabled={state.busy}
        onClick={() => void controller?.load()}
        style={{ minHeight: 44 }}
      >
        {text('compare')}
      </button>
      {state.canCompare && row ? (
        <>
          <p>{text('current', { value: row.value, version: row.version })}</p>
          <button
            type="button"
            onClick={() => controller?.acceptVersion()}
            style={{ minHeight: 44 }}
          >
            {text('adopt')}
          </button>
        </>
      ) : null}
    </div>
  );
  return null;
}

export function SettingStatus({
  state,
  controller,
}: {
  state: SettingsState;
  controller: SettingsController | null;
}): ReactElement | null {
  if (state.phase === 'conflict') return <ConflictStatus state={state} controller={controller} />;
  if (state.phase !== 'unknown') return null;

  return (
    <div
      role="alert"
      data-testid="setting-unknown"
      style={{ display: 'grid', gap: 8, overflowWrap: 'anywhere' }}
    >
      <p>{state.referenceId ? text('unknown', { id: state.referenceId }) : text('missing')}</p>
      <p>{text('unknownHelp')}</p>
      <button
        type="button"
        disabled={state.busy}
        onClick={() => void controller?.load()}
        style={{ minHeight: 44 }}
      >
        {text('lookup')}
      </button>
      <button
        type="button"
        disabled={state.busy || !controller?.canRetry()}
        onClick={() => void controller?.retry()}
        style={{ minHeight: 44 }}
      >
        {text('replay')}
      </button>
      <a href={state.draft ? auditLogHref(state.draft.key) : '/audit-logs'}>{text('audit')}</a>
    </div>
  );
}
