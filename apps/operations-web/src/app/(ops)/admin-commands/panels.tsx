import type { ReactElement } from 'react';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
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
        <p role="alert">
          {text('expired')} <a href="/login">{text('login')}</a>
        </p>
      ) : null}
      {state.phase === 'error' ? (
        <ScreenAlert error={state.error} onRetry={() => void controller?.load()} />
      ) : null}
      {state.phase === 'conflict' ? (
        <div role="alert" data-testid="admin-conflict">
          <p>{text('conflict', { version })}</p>
          <button
            type="button"
            disabled={state.busy}
            onClick={() => void controller?.load()}
            style={{ minHeight: 44 }}
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
    <div role="alert" data-testid="admin-unknown" style={{ overflowWrap: 'anywhere' }}>
      <p>
        {state.referenceId ? text('unknown', { id: state.referenceId }) : text('invalidIntent')}
      </p>
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
        {text('retry')}
      </button>
      <a href="/audit-logs">{text('audit')}</a>
    </div>
  );
}
