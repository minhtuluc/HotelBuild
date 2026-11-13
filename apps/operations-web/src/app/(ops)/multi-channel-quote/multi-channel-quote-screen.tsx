'use client';

/**
 * SCR-30 — Xem trước báo giá đa kênh (UC-RATE-05, BR-RATE-07,08,09,17): so sánh giá gộp, hoa hồng và
 * giá thuần của các kênh cho **một** loại phòng và một kỳ lưu trú.
 *
 * Màn hình **chỉ đọc**: một lời gọi `POST /quotes/multi-channel` cho mỗi lần xem, không nút chốt giá,
 * không tạo quote/snapshot; mọi con số in nguyên giá trị máy chủ trả (không làm tròn lại, không nhân hệ số).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createPropertyApi, createRateApi, isApiError, type ApiClient } from '@pinehill/api-client';
import type {
  ChannelCode,
  MultiChannelQuote,
  PropertySummary,
  RoomTypeSummary,
} from '@pinehill/contracts';
import {
  StateSurface,
  formatMoney,
  formatStatusWithEnum,
  space,
  type ScreenState,
} from '@pinehill/ui-web';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_FILTER_ROW_STYLE,
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_TABLE_WRAP_STYLE,
  OPS_TABULAR_STYLE,
  OPS_TITLE_STYLE,
  opsNoticeStyle,
} from '../../../components/editorial-styles';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { useOpsSession } from '../../../lib/ops-session';
import { t } from '../../../lib/i18n';
import { defaultRange } from '../../../lib/inventory-grid';
import {
  ALL_CHANNELS,
  buildRequest,
  channelsFor,
  hasServerWarning,
  rangeIssue,
  toggleChannel,
} from '../../../lib/multi-channel-quote';
import { readFailureState } from '../../../lib/screen-state';

interface Options {
  properties: readonly PropertySummary[];
  roomTypes: readonly RoomTypeSummary[];
  propertyId: string;
}

async function fetchOptions(client: ApiClient): Promise<Options> {
  const api = createPropertyApi(client);
  const properties = (await api.list()).data.data;
  const propertyId = properties[0]?.id ?? '';
  const roomTypes = propertyId === '' ? [] : (await api.listRoomTypes({ propertyId })).data.data;
  return { properties, roomTypes, propertyId };
}

function QuoteTable({ quote }: { quote: MultiChannelQuote }): ReactElement {
  const headers = [
    t('mcq.col.channel'),
    t('mcq.col.gross'),
    t('mcq.col.commission'),
    t('mcq.col.net'),
    t('mcq.col.nightly'),
    t('mcq.col.total'),
    t('mcq.col.warnings'),
  ];
  return (
    <div style={OPS_TABLE_WRAP_STYLE}>
      <table data-testid="mcq-table" style={{ ...OPS_TABULAR_STYLE, width: '100%' }}>
        <caption
          style={{ textAlign: 'start', padding: `${space.s3}px ${space.s4}px`, fontWeight: 600 }}
        >
          {t('mcq.table.title')}
        </caption>
        <thead>
          <tr>
            {headers.map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {quote.options.map((option) => (
            <tr key={option.channelCode} data-testid={`mcq-row-${option.channelCode}`}>
              <td>
                {formatStatusWithEnum(
                  t(`enum.channelCode.${option.channelCode}`),
                  option.channelCode,
                )}
              </td>
              {/* In nguyên số máy chủ trả: không làm tròn lại, không suy diễn. */}
              <td>{option.grossTotal === undefined ? '—' : formatMoney(option.grossTotal)}</td>
              <td>
                {option.commissionAmount === undefined
                  ? '—'
                  : `${formatMoney(option.commissionAmount)}${option.commissionPct === undefined ? '' : ` (${option.commissionPct}%)`}`}
              </td>
              <td>{option.netTotal === undefined ? '—' : formatMoney(option.netTotal)}</td>
              <td>{formatMoney(option.nightlyFrom)}</td>
              <td>{formatMoney(option.totalFrom)}</td>
              <td data-testid={`mcq-warnings-${option.channelCode}`}>
                {hasServerWarning(option) ? option.warnings.join(' · ') : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MultiChannelQuoteScreen(): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [options, setOptions] = useState<Options>({
    properties: [],
    roomTypes: [],
    propertyId: '',
  });
  const [roomTypeId, setRoomTypeId] = useState('');
  const [range, setRange] = useState(() => defaultRange(new Date()));
  const [selected, setSelected] = useState<readonly ChannelCode[]>([]);
  const [quote, setQuote] = useState<MultiChannelQuote | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const session = useOpsSession(['/properties', '/room-types', '/quotes'], {
    onExpired: () => setState({ kind: 'forbidden' }),
  });

  const load = useCallback(async (): Promise<void> => {
    setReadError(null);
    try {
      const loaded = await fetchOptions(session.client);
      setOptions(loaded);
      setRoomTypeId((current) =>
        loaded.roomTypes.some((type) => type.id === current)
          ? current
          : (loaded.roomTypes[0]?.id ?? ''),
      );
      setState({ kind: 'ready' });
    } catch (caught) {
      const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
      if (mapped !== undefined) {
        setState(mapped);
        return;
      }
      setReadError(caught);
      setState({ kind: 'ready' });
    }
  }, [session]);

  useEffect(() => {
    if (forced !== undefined) return;
    void load();
  }, [forced, load]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const issue = rangeIssue(range.from, range.to);
    if (issue !== null || roomTypeId === '') {
      setState({
        kind: 'validationError',
        details: issue === null ? [{ field: 'roomTypeId', issue: 'REQUIRED' }] : [issue],
      });
      return;
    }
    try {
      // Đúng **một** lời gọi cho mỗi lần xem; không tạo quote/snapshot (màn chỉ đọc).
      const result = await createRateApi(session.client).quoteMultiChannel(
        buildRequest({
          roomTypeId,
          checkIn: range.from,
          checkOut: range.to,
          selectedChannels: selected,
        }),
      );
      setQuote(result.data);
      setState({ kind: 'ready' });
    } catch (caught) {
      // Tuyến này **chỉ đọc** (không tạo quote/snapshot), nên lỗi xử như lỗi đọc: 403 → thiếu quyền,
      // còn lại hiện băng lỗi và **giữ nguyên** bảng đã xem (HB-062 AC7).
      const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
      if (mapped !== undefined) {
        setState(mapped);
        return;
      }
      setReadError(caught);
      setState({ kind: 'ready' });
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
        <h1 style={OPS_TITLE_STYLE}>{t('mcq.title')}</h1>
        <p style={OPS_INTRO_STYLE}>{t('mcq.intro')}</p>
      </header>
      <form
        data-testid="mcq-form"
        className="ph-card ph-filter-row"
        onSubmit={(event) => void submit(event)}
        style={OPS_FILTER_ROW_STYLE}
      >
        <label style={OPS_FIELD_LABEL_STYLE}>
          {t('mcq.form.property')}
          <select
            value={options.propertyId}
            onChange={(event) => {
              void (async () => {
                const api = createPropertyApi(session.client);
                const types = (await api.listRoomTypes({ propertyId: event.target.value })).data
                  .data;
                setOptions({ ...options, propertyId: event.target.value, roomTypes: types });
                setRoomTypeId(types[0]?.id ?? '');
              })();
            }}
          >
            {options.properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
        <label style={OPS_FIELD_LABEL_STYLE}>
          {t('mcq.form.roomType')}
          <select value={roomTypeId} onChange={(event) => setRoomTypeId(event.target.value)}>
            {options.roomTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.code}
              </option>
            ))}
          </select>
        </label>
        <label style={OPS_FIELD_LABEL_STYLE}>
          {t('mcq.form.checkIn')}
          <input
            type="date"
            value={range.from}
            onChange={(event) => setRange({ ...range, from: event.target.value })}
          />
        </label>
        <label style={OPS_FIELD_LABEL_STYLE}>
          {t('mcq.form.checkOut')}
          <input
            type="date"
            value={range.to}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
          />
        </label>
        <button type="submit" className="ph-btn-primary" style={OPS_COMPACT_BTN_STYLE}>
          {t('mcq.form.submit')}
        </button>
      </form>
      <fieldset
        data-testid="mcq-channels"
        className="ph-card"
        style={{ margin: 0, padding: space.s4, display: 'grid', gap: space.s2 }}
      >
        <legend style={{ fontWeight: 600, paddingInline: space.s2 }}>
          {t('mcq.form.channels')}
        </legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.s3 }}>
          {ALL_CHANNELS.map((code) => (
            <label
              key={code}
              style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 44 }}
            >
              <input
                type="checkbox"
                checked={selected.includes(code)}
                onChange={() => setSelected(toggleChannel(selected, code))}
              />
              {t(`enum.channelCode.${code}`)}
            </label>
          ))}
        </div>
        <p role="note" style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>
          {t('mcq.channels.default', { count: channelsFor(selected).length })}
        </p>
      </fieldset>
      <p role="note" style={opsNoticeStyle('neutral')}>
        {t('mcq.readonly')}
      </p>
      <StateSurface state={state}>
        {readError === null ? null : <ScreenAlert error={readError} onRetry={() => void load()} />}
        {quote === null ? null : (
          <>
            <p role="status" data-testid="mcq-note" style={opsNoticeStyle('info')}>
              {t('mcq.preview', { from: quote.checkIn, to: quote.checkOut })}
            </p>
            <QuoteTable quote={quote} />
          </>
        )}
      </StateSurface>
    </section>
  );
}
