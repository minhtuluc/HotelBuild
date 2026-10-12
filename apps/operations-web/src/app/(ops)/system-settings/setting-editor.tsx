import type { ReactElement } from 'react';
import type { SettingsController, SettingsState } from './controller';
import { t } from '../../../lib/i18n';
export function SettingEditor({
  state,
  controller,
}: {
  state: SettingsState;
  controller: SettingsController | null;
}): ReactElement | null {
  const draft = state.draft;
  if (!draft) return null;
  const row = state.rows.find((r) => r.key === draft.key);
  const locked = state.busy || state.phase === 'unknown' || state.phase === 'conflict' || !row;
  return (
    <form
      data-testid="setting-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void controller?.save();
      }}
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)', minWidth: 0 }}
    >
      <fieldset
        disabled={locked}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}
      >
        <legend>
          {t('settings.form.legend', {
            key: draft.key,
            type: row?.valueType ?? '',
            version: draft.version,
          })}
        </legend>
        <label style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          {t('settings.form.value')}
          <input
            value={draft.value}
            onChange={(e) => controller?.draft(e.target.value, draft.reason)}
            style={{ maxWidth: '100%' }}
          />
        </label>
        <label style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          {t('settings.form.reason')}
          <input
            value={draft.reason}
            maxLength={500}
            onChange={(e) => controller?.draft(draft.value, e.target.value)}
            style={{ maxWidth: '100%' }}
          />
        </label>
        <button type="submit" style={{ minHeight: 44 }}>
          {t('settings.form.save')}
        </button>
        <button type="button" onClick={() => controller?.cancel()} style={{ minHeight: 44 }}>
          {t('settings.form.cancel')}
        </button>
      </fieldset>
    </form>
  );
}
