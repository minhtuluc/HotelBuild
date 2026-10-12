'use client';
import type { ReactElement } from 'react';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { t } from '../../../lib/i18n';
import { SettingsTable } from './settings-table';
import { useSettings } from './use-settings';
import { settingsText } from './messages-session';
import { SettingEditor } from './setting-editor';
import { SettingStatus } from './setting-status';
import type { SettingsState } from './controller';
function surface(state: SettingsState): ScreenState {
  switch (state.phase) {
    case 'loading':
      return { kind: 'loading' };
    case 'empty':
      return { kind: 'empty', reason: 'noData', canCreate: false };
    case 'forbidden':
    case 'expired':
      return { kind: 'forbidden' };
    case 'validation':
      return { kind: 'validationError', details: state.issues };
    default:
      return { kind: 'ready' };
  }
}
export function SystemSettingsScreen(): ReactElement {
  const forced = useForcedState();
  const { controller, state } = useSettings(forced === undefined);
  if (forced !== undefined)
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  const blocked = state.busy || !['ready', 'empty', 'validation'].includes(state.phase);
  return (
    <section
      style={{
        padding: 'var(--space-s6, 24px)',
        display: 'grid',
        gap: 'var(--space-s4, 16px)',
        minWidth: 0,
      }}
    >
      <h1 style={{ margin: 0 }}>{t('settings.title')}</h1>
      <p style={{ margin: 0 }}>{t('settings.intro')}</p>
      <button
        type="button"
        data-testid="settings-reload"
        disabled={state.busy}
        onClick={() => void controller?.load()}
        style={{ minHeight: 44, justifySelf: 'start' }}
      >
        {settingsText('reload')}
      </button>
      {state.phase === 'expired' ? (
        <p role="alert">
          {settingsText('expired')} <a href="/login">{settingsText('login')}</a>
        </p>
      ) : null}
      <StateSurface state={surface(state)} />
      {state.phase === 'error' ? (
        <ScreenAlert error={state.error} onRetry={() => void controller?.load()} />
      ) : null}
      <SettingStatus state={state} controller={controller} />
      {state.rows.length ? (
        <SettingsTable
          rows={state.rows}
          canEdit={!blocked}
          onEdit={(row) => controller?.edit(row.key)}
        />
      ) : null}
      {state.saved ? (
        <p role="status" data-testid="settings-saved" style={{ margin: 0 }}>
          {t('settings.saved', { key: state.saved })}
        </p>
      ) : null}
      <SettingEditor state={state} controller={controller} />
    </section>
  );
}
