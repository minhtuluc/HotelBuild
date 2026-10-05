'use client';

/**
 * SCR-28 — Kênh: hệ số & hoa hồng (UC-RATE-03, BR-RATE-07,09,18): bảng kênh kèm **ngưỡng sàn tính
 * sẵn** `1/(1 − hoa hồng)` và cảnh báo (kênh `AGENCY` được miễn; kênh trực tiếp < 1,00 cảnh báo).
 * Sửa mặc định toàn chuỗi bằng `PATCH` + `If-Match`; ghi đè theo cơ sở gửi **dòng mới** có
 * `effectiveFrom` rồi đọc lại chi tiết. Cảnh báo chỉ để nhắc — máy chủ (HB-055) là nơi chặn.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createPropertyApi, createRateApi, isApiError } from '@pinehill/api-client';
import type {
  ChannelDetail,
  ChannelSummary,
  ChannelUpdateRequest,
  PropertySummary,
} from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import {
  EMPTY_OVERRIDE_DRAFT,
  changedFields,
  draftOf,
  ifMatchOf,
  overrideUpdateRequest,
  validateDraft,
  validateOverride,
  type ChannelDraft,
  type OverrideDraft,
} from '../../../lib/channels';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';
import { ChannelTable, OverrideTable } from './channel-tables';

const ROW_STYLE = {
  display: 'flex',
  gap: 'var(--space-s2, 8px)',
  flexWrap: 'wrap',
  alignItems: 'end',
} as const;

export function ChannelsScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [channels, setChannels] = useState<readonly ChannelSummary[]>([]);
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [selected, setSelected] = useState<ChannelDetail | null>(null);
  const [draft, setDraft] = useState<ChannelDraft | null>(null);
  const [override, setOverride] = useState<OverrideDraft>(EMPTY_OVERRIDE_DRAFT);
  const [saved, setSaved] = useState(false);
  const [readError, setReadError] = useState<unknown>(null);

  const load = useCallback(
    async (channelId: string | null): Promise<void> => {
      setReadError(null);
      const client = opsApiClient(baseUrl);
      try {
        const rateApi = createRateApi(client);
        const [channelPage, propertyPage] = await Promise.all([
          rateApi.listChannels(),
          createPropertyApi(client).list(),
        ]);
        setChannels(channelPage.data.data);
        setProperties(propertyPage.data.data);
        if (channelId !== null) {
          const detail = await rateApi.channel(channelId);
          setSelected(detail.data);
          setDraft(draftOf(detail.data));
        }
        setState(
          channelPage.data.data.length === 0
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
    },
    [baseUrl],
  );

  useEffect(() => {
    if (forced !== undefined) return;
    void load(null);
  }, [forced, load]);

  /** Gửi `PATCH` với `If-Match` theo phiên bản đang hiển thị rồi đọc lại; lỗi dùng `writeFailureState`. */
  const patch = async (input: ChannelUpdateRequest): Promise<void> => {
    if (selected === null) return;
    try {
      await createRateApi(opsApiClient(baseUrl)).updateChannel(
        selected.id,
        input,
        ifMatchOf(selected.version),
      );
      setSaved(true);
      await load(selected.id);
      setState({ kind: 'ready' });
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: String(selected.version),
          onReload: () => void load(selected.id),
          onLookup: () => void load(selected.id),
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
      <h1 style={{ margin: 0 }}>{t('channels.title')}</h1>
      <p style={{ margin: 0 }}>{t('channels.intro')}</p>
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(selected?.id ?? null)} />
        )}
        {channels.length === 0 ? null : (
          <ChannelTable
            channels={channels}
            selectedId={selected?.id ?? null}
            onEdit={(channel) => {
              setSaved(false);
              setOverride(EMPTY_OVERRIDE_DRAFT);
              void load(channel.id);
            }}
          />
        )}
        {saved ? (
          <p role="status" data-testid="channels-note" style={{ margin: 0 }}>
            {t('channels.saved')}
          </p>
        ) : null}
        {selected === null || draft === null ? null : (
          <>
            <form
              data-testid="channel-editor"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                const issues = validateDraft(draft);
                if (issues.length > 0) {
                  setState({ kind: 'validationError', details: issues });
                  return;
                }
                void patch(changedFields(draft, selected));
              }}
              style={ROW_STYLE}
            >
              <legend>
                {t('channels.form.legend', { code: selected.code, version: selected.version })}
              </legend>
              <label style={{ display: 'grid', gap: 4 }}>
                {t('channels.form.multiplier')}
                <input
                  value={draft.multiplier}
                  onChange={(event) => setDraft({ ...draft, multiplier: event.target.value })}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                {t('channels.form.commission')}
                <input
                  value={draft.commissionPct}
                  onChange={(event) => setDraft({ ...draft, commissionPct: event.target.value })}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                {t('channels.form.hold')}
                <input
                  value={draft.holdMinutes}
                  onChange={(event) => setDraft({ ...draft, holdMinutes: event.target.value })}
                />
              </label>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={draft.overbookAllowed}
                  onChange={(event) =>
                    setDraft({ ...draft, overbookAllowed: event.target.checked })
                  }
                />
                {t('channels.form.overbook')}
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                {t('channels.form.reason')}
                <input
                  value={draft.reason}
                  onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                />
              </label>
              <button type="submit" style={{ minHeight: 44 }}>
                {t('channels.form.save')}
              </button>
            </form>
            <form
              data-testid="channel-override"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                const issues = validateOverride(override);
                if (issues.length > 0) {
                  setState({ kind: 'validationError', details: issues });
                  return;
                }
                const reason =
                  draft.reason.trim() === '' ? t('channels.override.reason') : draft.reason;
                void patch(overrideUpdateRequest(override, reason));
              }}
              style={ROW_STYLE}
            >
              <label style={{ display: 'grid', gap: 4 }}>
                {t('channels.override.property')}
                <select
                  value={override.propertyId}
                  onChange={(event) => setOverride({ ...override, propertyId: event.target.value })}
                >
                  <option value="">{t('channels.override.propertyPlaceholder')}</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                {t('channels.override.multiplier')}
                <input
                  value={override.multiplier}
                  onChange={(event) => setOverride({ ...override, multiplier: event.target.value })}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                {t('channels.override.commission')}
                <input
                  value={override.commissionPct}
                  onChange={(event) =>
                    setOverride({ ...override, commissionPct: event.target.value })
                  }
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                {t('channels.override.effectiveFrom')}
                <input
                  type="date"
                  value={override.effectiveFrom}
                  onChange={(event) =>
                    setOverride({ ...override, effectiveFrom: event.target.value })
                  }
                />
              </label>
              <button type="submit" style={{ minHeight: 44 }}>
                {t('channels.override.add')}
              </button>
            </form>
            <OverrideTable channel={selected} />
          </>
        )}
      </StateSurface>
    </section>
  );
}
