import type { ReactElement } from 'react';
import { StateSurface, color, space, type ScreenState } from '@pinehill/ui-web';
import { OPS_COMPACT_BTN_STYLE, opsNoticeStyle } from '../../../components/editorial-styles';
import { ScreenAlert } from '../../../components/screen-alert';
import { VERSION_NEW } from '../../../lib/screen-state';
import type { AdminController, AdminState } from './controller';
import { adminText as text } from './messages';

function surface(state: AdminState): ScreenState {
  if (state.phase === 'loading') return { kind: 'loading' };
  if (state.phase === 'forbidden' || state.phase === 'expired') return { kind: 'forbidden' };
  if (state.phase === 'validation') return { kind: 'validationError', details: state.issues };
  return { kind: 'ready' };
}

export function AdminPanels({
  state,
  controller,
  version = VERSION_NEW,
}: {
  state: AdminState;
  controller: AdminController | null;
  version?: string;
}): ReactElement {
  return (
    <>
      <StateSurface state={surface(state)} />
      {state.phase === 'expired' ? (
        <p role="alert" style={opsNoticeStyle('danger')}>
          <span>
            {text('expired')}{' '}
            <a href="/login" style={{ color: color.primary, fontWeight: 500 }}>
              {text('login')}
            </a>
          </span>
        </p>
      ) : null}
      {state.phase === 'error' ? (
        <ScreenAlert error={state.error} onRetry={() => void controller?.load()} />
      ) : null}
      {state.phase === 'conflict' ? (
        <div role="alert" data-testid="admin-conflict" style={opsNoticeStyle('warning')}>
          <p style={{ margin: 0 }}>{text('conflict', { version })}</p>
          <button
            type="button"
            disabled={state.busy}
            onClick={() => void controller?.load()}
            className="ph-btn"
            style={{ ...OPS_COMPACT_BTN_STYLE, justifySelf: 'start' }}
          >
            {text('compare')}
          </button>
        </div>
      ) : null}
      {state.phase === 'unknown' ? <UnknownPanel state={state} controller={controller} /> : null}
    </>
  );
}

function UnknownPanel({
  state,
  controller,
}: {
  state: AdminState;
  controller: AdminController | null;
}): ReactElement {
  return (
    <div
      role="alert"
      data-testid="admin-unknown"
      style={{ ...opsNoticeStyle('info'), overflowWrap: 'anywhere' }}
    >
      <p style={{ margin: 0, fontWeight: 500 }}>
        {state.referenceId ? text('unknown', { id: state.referenceId }) : text('invalidIntent')}
      </p>
      <p style={{ margin: 0, fontSize: 13, color: color.textMuted }}>{text('unknownHelp')}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.s2, alignItems: 'center' }}>
        <button
          type="button"
          disabled={state.busy}
          onClick={() => void controller?.load()}
          className="ph-btn"
          style={OPS_COMPACT_BTN_STYLE}
        >
          {text('lookup')}
        </button>
        <button
          type="button"
          disabled={state.busy || !controller?.canRetry()}
          onClick={() => void controller?.retry()}
          className="ph-btn-primary"
          style={OPS_COMPACT_BTN_STYLE}
        >
          {text('retry')}
        </button>
        <a href="/audit-logs" className="ph-btn" style={OPS_COMPACT_BTN_STYLE}>
          {text('audit')}
        </a>
      </div>
    </div>
  );
}
