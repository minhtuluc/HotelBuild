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
import { useOpsSession } from '../../../lib/ops-session';
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
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_FILTER_ROW_STYLE,
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_TITLE_STYLE,
  opsNoticeStyle,
} from '../../../components/editorial-styles';
import { ChannelTable, OverrideTable } from './channel-tables';

export function ChannelsScreen(): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [channels, setChannels] = useState<readonly ChannelSummary[]>([]);
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [selected, setSelected] = useState<ChannelDetail | null>(null);
  const [draft, setDraft] = useState<ChannelDraft | null>(null);
  const [override, setOverride] = useState<OverrideDraft>(EMPTY_OVERRIDE_DRAFT);
  const [saved, setSaved] = useState(false);
  const [readError, setReadError] = useState<unknown>(null);
  const session = useOpsSession(['/channels', '/properties'], {
    onExpired: () => setState({ kind: 'forbidden' }),
  });

  const load = useCallback(
    async (channelId: string | null): Promise<void> => {
      setReadError(null);
      const client = session.client;
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
    [session],
  );

  useEffect(() => {
    if (forced !== undefined) return;
    void load(null);
  }, [forced, load]);

  /** Gửi `PATCH` với `If-Match` theo phiên bản đang hiển thị rồi đọc lại; lỗi dùng `writeFailureState`. */
  const patch = async (input: ChannelUpdateRequest): Promise<void> => {
    if (selected === null) return;
    try {
      await createRateApi(session.client).updateChannel(
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
    <section style={OPS_PAGE_STYLE}>
      <header style={OPS_HEADER_STYLE}>
        <h1 style={OPS_TITLE_STYLE}>{t('channels.title')}</h1>
        <p style={OPS_INTRO_STYLE}>{t('channels.intro')}</p>
      </header>
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
          <p role="status" data-testid="channels-note" style={opsNoticeStyle('success')}>
            {t('channels.saved')}
          </p>
        ) : null}
        {selected === null || draft === null ? null : (
          <>
            <form
              data-testid="channel-editor"
              className="ph-card ph-filter-row"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                const issues = validateDraft(draft);
                if (issues.length > 0) {
                  setState({ kind: 'validationError', details: issues });
                  return;
                }
                void patch(changedFields(draft, selected));
              }}
              style={OPS_FILTER_ROW_STYLE}
            >
              <legend style={{ fontWeight: 600 }}>
                {t('channels.form.legend', { code: selected.code, version: selected.version })}
              </legend>
              <label style={OPS_FIELD_LABEL_STYLE}>
                {t('channels.form.multiplier')}
                <input
                  value={draft.multiplier}
                  onChange={(event) => setDraft({ ...draft, multiplier: event.target.value })}
                />
              </label>
              <label style={OPS_FIELD_LABEL_STYLE}>
                {t('channels.form.commission')}
                <input
                  value={draft.commissionPct}
                  onChange={(event) => setDraft({ ...draft, commissionPct: event.target.value })}
                />
              </label>
              <label style={OPS_FIELD_LABEL_STYLE}>
                {t('channels.form.hold')}
                <input
                  value={draft.holdMinutes}
                  onChange={(event) => setDraft({ ...draft, holdMinutes: event.target.value })}
                />
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 44 }}>
                <input
                  type="checkbox"
                  checked={draft.overbookAllowed}
                  onChange={(event) =>
                    setDraft({ ...draft, overbookAllowed: event.target.checked })
                  }
                />
                {t('channels.form.overbook')}
              </label>
              <label style={OPS_FIELD_LABEL_STYLE}>
                {t('channels.form.reason')}
                <input
                  value={draft.reason}
                  onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                />
              </label>
              <button type="submit" className="ph-btn-primary" style={OPS_COMPACT_BTN_STYLE}>
                {t('channels.form.save')}
              </button>
            </form>
            <form
              data-testid="channel-override"
              className="ph-card ph-filter-row"
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
              style={OPS_FILTER_ROW_STYLE}
            >
              <label style={OPS_FIELD_LABEL_STYLE}>
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
              <label style={OPS_FIELD_LABEL_STYLE}>
                {t('channels.override.multiplier')}
                <input
                  value={override.multiplier}
                  onChange={(event) => setOverride({ ...override, multiplier: event.target.value })}
                />
              </label>
              <label style={OPS_FIELD_LABEL_STYLE}>
                {t('channels.override.commission')}
                <input
                  value={override.commissionPct}
                  onChange={(event) =>
                    setOverride({ ...override, commissionPct: event.target.value })
                  }
                />
              </label>
              <label style={OPS_FIELD_LABEL_STYLE}>
                {t('channels.override.effectiveFrom')}
                <input
                  type="date"
                  value={override.effectiveFrom}
                  onChange={(event) =>
                    setOverride({ ...override, effectiveFrom: event.target.value })
                  }
                />
              </label>
              <button type="submit" className="ph-btn-primary" style={OPS_COMPACT_BTN_STYLE}>
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
