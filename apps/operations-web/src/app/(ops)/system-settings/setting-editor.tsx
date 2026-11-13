import type { ReactElement } from 'react';
import { space } from '@pinehill/ui-web';
import { OPS_COMPACT_BTN_STYLE, OPS_FIELD_LABEL_STYLE } from '../../../components/editorial-styles';
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
      className="ph-card"
      onSubmit={(e) => {
        e.preventDefault();
        void controller?.save();
      }}
      style={{ display: 'grid', gap: space.s2, minWidth: 0, padding: space.s4 }}
    >
      <fieldset
        disabled={locked}
        style={{
          display: 'flex',
          gap: space.s3,
          flexWrap: 'wrap',
          alignItems: 'end',
          minWidth: 0,
          border: 0,
          padding: 0,
          margin: 0,
        }}
      >
        <legend style={{ fontWeight: 600, marginBottom: space.s2 }}>
          {t('settings.form.legend', {
            key: draft.key,
            type: row?.valueType ?? '',
            version: draft.version,
          })}
        </legend>
        <label style={OPS_FIELD_LABEL_STYLE}>
          {t('settings.form.value')}
          <input
            value={draft.value}
            onChange={(e) => controller?.draft(e.target.value, draft.reason)}
            style={{ maxWidth: '100%' }}
          />
        </label>
        <label style={OPS_FIELD_LABEL_STYLE}>
          {t('settings.form.reason')}
          <input
            value={draft.reason}
            maxLength={500}
            onChange={(e) => controller?.draft(draft.value, e.target.value)}
            style={{ maxWidth: '100%' }}
          />
        </label>
        <button type="submit" className="ph-btn-primary" style={OPS_COMPACT_BTN_STYLE}>
          {t('settings.form.save')}
        </button>
        <button
          type="button"
          className="ph-btn"
          onClick={() => controller?.cancel()}
          style={OPS_COMPACT_BTN_STYLE}
        >
          {t('settings.form.cancel')}
        </button>
      </fieldset>
    </form>
  );
}
