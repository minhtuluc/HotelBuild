'use client';

/**
 * SCR-29 — Khuyến mãi (UC-RATE-04, BR-RATE-10,11,13): bảng mã hiện có (lượt đã dùng/tối đa, phạm vi,
 * trạng thái) và form tạo mã kiểm **đủ trường** trước khi gửi. Giá chạm sàn bị máy chủ **chặn** bằng
 * `422 E_RATE_BELOW_FLOOR` (khác báo giá — ở đó cùng mã là cảnh báo, api.md §4.2); màn hình giữ nguyên
 * bản nhập và hiện đúng nhóm nguyên nhân theo `details[]`, không hiện `message` thô.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createPropertyApi, createRateApi, isApiError } from '@pinehill/api-client';
import type { PromotionSummary, RoomTypeSummary } from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import {
  CHANNEL_CODES,
  EMPTY_PROMOTION_DRAFT,
  PROMOTION_TYPES,
  toCreateRequest,
  toggle,
  validateDraft,
  valueUnitKey,
  type FieldIssue,
  type PromotionDraft,
} from '../../../lib/promotions';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';
import { PromotionTable } from './promotion-table';

/** Hai mã máy chủ trả kèm `details[]` khi cấu hình khuyến mãi sai (api.md §4.2). */
const CONFIG_CODES: Readonly<Record<string, 'promotions.floorBlocked' | 'promotions.invalid'>> = {
  E_RATE_BELOW_FLOOR: 'promotions.floorBlocked',
  E_RATE_PROMO_INVALID: 'promotions.invalid',
};

const ROW_STYLE = {
  display: 'flex',
  gap: 'var(--space-s2, 8px)',
  flexWrap: 'wrap',
  alignItems: 'end',
} as const;

export function PromotionsScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [rows, setRows] = useState<readonly PromotionSummary[]>([]);
  const [roomTypes, setRoomTypes] = useState<readonly RoomTypeSummary[]>([]);
  const [draft, setDraft] = useState<PromotionDraft>(EMPTY_PROMOTION_DRAFT);
  const [saved, setSaved] = useState<string | null>(null);
  const [configIssue, setConfigIssue] = useState<{
    messageKey: 'promotions.floorBlocked' | 'promotions.invalid';
    details: readonly FieldIssue[];
  } | null>(null);
  const [readError, setReadError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    setReadError(null);
    const client = opsApiClient(baseUrl);
    try {
      const propertyPage = await createPropertyApi(client).list();
      const propertyId = propertyPage.data.data[0]?.id;
      const [promotionPage, typePage] = await Promise.all([
        createRateApi(client).listPromotions(),
        propertyId === undefined
          ? Promise.resolve(undefined)
          : createPropertyApi(client).listRoomTypes({ propertyId }),
      ]);
      setRows(promotionPage.data.data);
      setRoomTypes(typePage?.data.data ?? []);
      setState(
        promotionPage.data.data.length === 0
          ? { kind: 'empty', reason: 'noData', canCreate: false }
          : { kind: 'ready' },
      );
    } catch (caught) {
      const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
      if (mapped !== undefined) {
        setState(mapped);
        return;
      }
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
    const issues = validateDraft(draft);
    if (issues.length > 0) {
      setState({ kind: 'validationError', details: issues });
      return;
    }
    setConfigIssue(null);
    try {
      await createRateApi(opsApiClient(baseUrl)).createPromotion(toCreateRequest(draft));
      setSaved(draft.code.trim().toUpperCase());
      setDraft(EMPTY_PROMOTION_DRAFT);
      await load();
      setState({ kind: 'ready' });
    } catch (caught) {
      if (isApiError(caught) && caught.code !== undefined) {
        const messageKey = CONFIG_CODES[caught.code];
        if (messageKey !== undefined) {
          // Giữ nguyên bản nhập; hiện đúng nhóm nguyên nhân theo `details[]` (không hiện message thô).
          setConfigIssue({ messageKey, details: caught.details ?? [] });
          setState({ kind: 'ready' });
          return;
        }
      }
      setState(
        writeFailureState(caught, {
          attemptedVersion: '—',
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
      <h1 style={{ margin: 0 }}>{t('promotions.title')}</h1>
      <p style={{ margin: 0 }}>{t('promotions.intro')}</p>
      <StateSurface state={state}>
        {readError === null ? null : <ScreenAlert error={readError} onRetry={() => void load()} />}
        {rows.length === 0 ? null : <PromotionTable rows={rows} />}
        {saved === null ? null : (
          <p role="status" data-testid="promotions-saved" style={{ margin: 0 }}>
            {t('promotions.saved', { code: saved })}
          </p>
        )}
        {configIssue === null ? null : (
          <div role="alert" data-testid="promotions-config-issue">
            <p>{t(configIssue.messageKey)}</p>
            <ul>
              {configIssue.details.map((detail) => (
                <li key={`${detail.field}-${detail.issue}`}>
                  {t('state.validation.field', { field: detail.field, issue: detail.issue })}
                </li>
              ))}
            </ul>
          </div>
        )}
        <form
          data-testid="promotion-form"
          onSubmit={(event) => void submit(event)}
          style={ROW_STYLE}
        >
          <label style={{ display: 'grid', gap: 4 }}>
            {t('promotions.form.code')}
            <input
              value={draft.code}
              onChange={(event) => setDraft({ ...draft, code: event.target.value })}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('promotions.form.type')}
            <select
              value={draft.type}
              onChange={(event) => {
                const value = event.target.value;
                const next = PROMOTION_TYPES.find((type) => type === value);
                if (next !== undefined) setDraft({ ...draft, type: next });
              }}
            >
              {PROMOTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === 'PERCENT' ? t('promotions.type.PERCENT') : t('promotions.type.AMOUNT')}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t(valueUnitKey(draft.type))}
            <input
              value={draft.value}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('promotions.form.minNights')}
            <input
              value={draft.minNights}
              onChange={(event) => setDraft({ ...draft, minNights: event.target.value })}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('promotions.form.maxUses')}
            <input
              value={draft.maxUses}
              onChange={(event) => setDraft({ ...draft, maxUses: event.target.value })}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('promotions.form.validFrom')}
            <input
              type="datetime-local"
              value={draft.validFrom}
              onChange={(event) => setDraft({ ...draft, validFrom: event.target.value })}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            {t('promotions.form.validTo')}
            <input
              type="datetime-local"
              value={draft.validTo}
              onChange={(event) => setDraft({ ...draft, validTo: event.target.value })}
            />
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={draft.stackable}
              onChange={(event) => setDraft({ ...draft, stackable: event.target.checked })}
            />
            {t('promotions.form.stackable')}
          </label>
          <fieldset data-testid="promotion-channels" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>{t('promotions.form.channels')}</legend>
            {CHANNEL_CODES.map((code) => (
              <label key={code} style={{ display: 'inline-flex', gap: 4, marginInlineEnd: 8 }}>
                <input
                  type="checkbox"
                  checked={draft.channelScope.includes(code)}
                  onChange={() =>
                    setDraft({ ...draft, channelScope: toggle(draft.channelScope, code) })
                  }
                />
                {t(`enum.channelCode.${code}`)}
              </label>
            ))}
          </fieldset>
          <fieldset data-testid="promotion-roomtypes" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>{t('promotions.form.roomTypes')}</legend>
            {roomTypes.map((type) => (
              <label key={type.id} style={{ display: 'inline-flex', gap: 4, marginInlineEnd: 8 }}>
                <input
                  type="checkbox"
                  checked={draft.roomTypeScope.includes(type.id)}
                  onChange={() =>
                    setDraft({ ...draft, roomTypeScope: toggle(draft.roomTypeScope, type.id) })
                  }
                />
                {type.code}
              </label>
            ))}
          </fieldset>
          <button type="submit" style={{ minHeight: 44 }}>
            {t('promotions.create')}
          </button>
        </form>
      </StateSurface>
    </section>
  );
}
