import type { ReactElement } from 'react';
import { space } from '@pinehill/ui-web';
import { OPS_COMPACT_BTN_STYLE, opsNoticeStyle } from '../../../components/editorial-styles';
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
    <div role="alert" data-testid="setting-conflict" style={opsNoticeStyle('warning')}>
      <p style={{ margin: 0 }}>{text('conflict', { version: state.draft?.version ?? '' })}</p>
      <div style={{ display: 'flex', gap: space.s2, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="ph-btn"
          disabled={state.busy}
          onClick={() => void controller?.load()}
          style={OPS_COMPACT_BTN_STYLE}
        >
          {text('compare')}
        </button>
        {state.canCompare && row ? (
          <>
            <p style={{ margin: 0 }}>
              {text('current', { value: row.value, version: row.version })}
            </p>
            <button
              type="button"
              className="ph-btn-primary"
              onClick={() => controller?.acceptVersion()}
              style={OPS_COMPACT_BTN_STYLE}
            >
              {text('adopt')}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
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
      style={{ ...opsNoticeStyle('warning'), overflowWrap: 'anywhere' }}
    >
      <p style={{ margin: 0 }}>
        {state.referenceId ? text('unknown', { id: state.referenceId }) : text('missing')}
      </p>
      <p style={{ margin: 0 }}>{text('unknownHelp')}</p>
      <div style={{ display: 'flex', gap: space.s2, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="ph-btn"
          disabled={state.busy}
          onClick={() => void controller?.load()}
          style={OPS_COMPACT_BTN_STYLE}
        >
          {text('lookup')}
        </button>
        <button
          type="button"
          className="ph-btn-primary"
          disabled={state.busy || !controller?.canRetry()}
          onClick={() => void controller?.retry()}
          style={OPS_COMPACT_BTN_STYLE}
        >
          {text('replay')}
        </button>
        <a href={state.draft ? auditLogHref(state.draft.key) : '/audit-logs'}>{text('audit')}</a>
      </div>
    </div>
  );
}
