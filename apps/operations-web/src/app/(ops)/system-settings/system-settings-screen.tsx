'use client';

/**
 * SCR-17 — Tham số hệ thống (UC-SYS-02, BR-SYS-02,05): bảng tham số kèm giá trị hiện tại, kiểu giá trị,
 * mô tả, người sửa cuối, mốc giờ VN và phiên bản; sửa bằng `PUT` + `If-Match` **bắt buộc lý do**.
 * Ô nhập kiểm theo `valueType` tại chỗ; `412`/`428` hiện xung đột (trạng thái §8.1 thay nội dung như
 * SCR-19); lịch sử điều hướng sang SCR-16 kèm lọc sẵn.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createSystemApi, isApiError } from '@pinehill/api-client';
import type { SystemSetting } from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { ifMatchOf, updateRequest, validateEdit } from '../../../lib/system-settings';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';
import { SettingsTable } from './settings-table';

interface Draft {
  key: string;
  valueType: SystemSetting['valueType'];
  version: number;
  value: string;
  reason: string;
}

export function SystemSettingsScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [rows, setRows] = useState<readonly SystemSetting[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  // 403 khi đọc → không render ô sửa (AC5).
  const canEdit = state.kind !== 'forbidden';

  const load = useCallback(async (): Promise<void> => {
    setReadError(null);
    try {
      const page = await createSystemApi(opsApiClient(baseUrl)).listSettings();
      setRows(page.data.data);
      setState(
        page.data.data.length === 0
          ? { kind: 'empty', reason: 'noData', canCreate: false }
          : { kind: 'ready' },
      );
    } catch (caught) {
      const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
      if (mapped !== undefined) {
        setState(mapped);
        return;
      }
      // Giữ nguyên bảng đã có; băng lỗi nói rõ chưa đọc được thay vì hiện "chưa có dữ liệu".
      setReadError(caught);
      setState({ kind: 'ready' });
    }
  }, [baseUrl]);

  useEffect(() => {
    if (forced !== undefined) return;
    void load();
  }, [forced, load]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (draft === null) return;
    const setting = rows.find((row) => row.key === draft.key);
    if (setting === undefined) return;
    const issues = validateEdit(setting, draft.value, draft.reason);
    if (issues.length > 0) {
      setState({ kind: 'validationError', details: issues });
      return;
    }
    const { value, reason } = updateRequest(draft.value, draft.reason);
    try {
      await createSystemApi(opsApiClient(baseUrl)).updateSetting(
        draft.key,
        { value, reason },
        ifMatchOf(draft.version),
      );
      setSaved(draft.key);
      setDraft(null);
      await load();
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: String(draft.version),
          onReload: () => void load(),
          onLookup: () => void load(),
        }),
      );
    }
  };

  if (forced !== undefined) {
    return (
      <StateSurface state={forced}>
        <p>{t('screen.demo')}</p>
      </StateSurface>
    );
  }

  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('settings.title')}</h1>
      <p style={{ margin: 0 }}>{t('settings.intro')}</p>
      <StateSurface state={state}>
        {readError === null ? null : <ScreenAlert error={readError} onRetry={() => void load()} />}
        {rows.length === 0 ? null : (
          <SettingsTable
            rows={rows}
            canEdit={canEdit}
            onEdit={(setting) => {
              setSaved(null);
              setDraft({
                key: setting.key,
                valueType: setting.valueType,
                version: setting.version,
                value: setting.value,
                reason: '',
              });
            }}
          />
        )}
        {saved === null ? null : (
          <p role="status" data-testid="settings-saved" style={{ margin: 0 }}>
            {t('settings.saved', { key: saved })}
          </p>
        )}
        {draft === null ? null : (
          <form
            data-testid="setting-editor"
            onSubmit={(event) => void submit(event)}
            style={{
              display: 'flex',
              gap: 'var(--space-s2, 8px)',
              flexWrap: 'wrap',
              alignItems: 'end',
            }}
          >
            <legend>
              {t('settings.form.legend', {
                key: draft.key,
                type: draft.valueType,
                version: draft.version,
              })}
            </legend>
            <label style={{ display: 'grid', gap: 4 }}>
              {t('settings.form.value')}
              <input
                value={draft.value}
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              {t('settings.form.reason')}
              <input
                value={draft.reason}
                onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
              />
            </label>
            <button type="submit" style={{ minHeight: 44 }}>
              {t('settings.form.save')}
            </button>
            <button type="button" onClick={() => setDraft(null)} style={{ minHeight: 44 }}>
              {t('settings.form.cancel')}
            </button>
          </form>
        )}
      </StateSurface>
    </section>
  );
}
