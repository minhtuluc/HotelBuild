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
  type ScreenState,
} from '@pinehill/ui-web';
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
    <div style={{ overflowX: 'auto' }}>
      <table data-testid="mcq-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
          {t('mcq.table.title')}
        </caption>
        <thead>
          <tr>
            {headers.map((label) => (
              <th
                key={label}
                scope="col"
                style={{ textAlign: 'start', borderBottom: '1px solid var(--color-border)' }}
              >
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
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('mcq.title')}</h1>
      <p style={{ margin: 0 }}>{t('mcq.intro')}</p>
      <form
        data-testid="mcq-form"
        onSubmit={(event) => void submit(event)}
        style={{
          display: 'flex',
          gap: 'var(--space-s2, 8px)',
          flexWrap: 'wrap',
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'grid', gap: 4 }}>
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
        <label style={{ display: 'grid', gap: 4 }}>
          {t('mcq.form.roomType')}
          <select value={roomTypeId} onChange={(event) => setRoomTypeId(event.target.value)}>
            {options.roomTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.code}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('mcq.form.checkIn')}
          <input
            type="date"
            value={range.from}
            onChange={(event) => setRange({ ...range, from: event.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('mcq.form.checkOut')}
          <input
            type="date"
            value={range.to}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
          />
        </label>
        <button type="submit" style={{ minHeight: 44 }}>
          {t('mcq.form.submit')}
        </button>
      </form>
      <fieldset data-testid="mcq-channels" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>{t('mcq.form.channels')}</legend>
        {ALL_CHANNELS.map((code) => (
          <label key={code} style={{ display: 'inline-flex', gap: 4, marginInlineEnd: 8 }}>
            <input
              type="checkbox"
              checked={selected.includes(code)}
              onChange={() => setSelected(toggleChannel(selected, code))}
            />
            {t(`enum.channelCode.${code}`)}
          </label>
        ))}
        <p role="note" style={{ margin: 0 }}>
          {t('mcq.channels.default', { count: channelsFor(selected).length })}
        </p>
      </fieldset>
      <p role="note" style={{ margin: 0 }}>
        {t('mcq.readonly')}
      </p>
      <StateSurface state={state}>
        {readError === null ? null : <ScreenAlert error={readError} onRetry={() => void load()} />}
        {quote === null ? null : (
          <>
            <p role="status" data-testid="mcq-note" style={{ margin: 0 }}>
              {t('mcq.preview', { from: quote.checkIn, to: quote.checkOut })}
            </p>
            <QuoteTable quote={quote} />
          </>
        )}
      </StateSurface>
    </section>
  );
}
