'use client';

/**
 * SCR-25 — Allotment theo kênh (UC-INV-03, BR-INV-05, BR-CHAN-01,06,08): chọn kênh + loại phòng + khoảng
 * ngày, xem bảng ngày · hạn mức · đã dùng, sửa theo lô và lưu bằng **một** `PUT` (items chỉ ngày đã đổi)
 * kèm `If-Match` lấy từ `ETag` của lần đọc. Cảnh báo vượt số đơn vị bán `ACTIVE` chỉ để nhắc —
 * máy chủ chặn là cuối (BR-INV-05). Kênh trực tiếp không có hạn mức riêng (BR-CHAN-08).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  createInventoryApi,
  createPropertyApi,
  createRateApi,
  isApiError,
} from '@pinehill/api-client';
import type {
  AllotmentRow,
  ChannelSummary,
  PropertySummary,
  RoomTypeSummary,
} from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { opsApiClient } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { defaultRange, type GridRange } from '../../../lib/inventory-grid';
import { readFailureState, writeFailureState } from '../../../lib/screen-state';
import {
  changedItems,
  emptyRowsFor,
  validateDrafts,
  type AllotmentDraftRow,
} from '../../../lib/allotments';
import { AllotmentTable } from './allotment-table';

interface Target {
  propertyId: string;
  channelId: string;
  roomTypeId: string;
  range: GridRange;
}

interface Options {
  properties: readonly PropertySummary[];
  roomTypes: readonly RoomTypeSummary[];
  channels: readonly ChannelSummary[];
}

const EMPTY_OPTIONS: Options = { properties: [], roomTypes: [], channels: [] };

const ROW_STYLE = {
  display: 'flex',
  gap: 'var(--space-s2, 8px)',
  flexWrap: 'wrap',
  alignItems: 'end',
} as const;

interface LoadedOptions extends Options {
  propertyId: string;
  channelId: string;
  roomTypeId: string;
}

/** Các lựa chọn đã đổi so với lần đọc trước (điền mặc định xong) chưa. */
function idsDiffer(wanted: Target, loaded: LoadedOptions): boolean {
  return (
    loaded.propertyId !== wanted.propertyId ||
    loaded.channelId !== wanted.channelId ||
    loaded.roomTypeId !== wanted.roomTypeId
  );
}

function pickId(chosen: string, fallback: string | undefined): string {
  return chosen === '' ? (fallback ?? '') : chosen;
}

/** Đọc cơ sở, kênh và loại phòng; điền mặc định cho các lựa chọn người dùng chưa chọn. */
async function fetchOptions(baseUrl: string, wanted: Target): Promise<LoadedOptions> {
  const propertyApi = createPropertyApi(opsApiClient(baseUrl));
  const [propertiesPage, channelsPage] = await Promise.all([
    propertyApi.list(),
    createRateApi(opsApiClient(baseUrl)).listChannels(),
  ]);
  const properties = propertiesPage.data.data;
  const channels = channelsPage.data.data;
  const propertyId = pickId(wanted.propertyId, properties[0]?.id);
  const roomTypes =
    propertyId === '' ? [] : (await propertyApi.listRoomTypes({ propertyId })).data.data;
  return {
    properties,
    channels,
    roomTypes,
    propertyId,
    channelId: pickId(wanted.channelId, channels[0]?.id),
    roomTypeId: pickId(wanted.roomTypeId, roomTypes[0]?.id),
  };
}

/** Đọc lô allotment kèm `ETag` của lần đọc (dùng cho `If-Match` khi lưu). */
async function fetchRows(
  baseUrl: string,
  ids: { channelId: string; roomTypeId: string },
  range: GridRange,
): Promise<{ rows: readonly AllotmentRow[]; etag: string | null }> {
  const page = await createInventoryApi(opsApiClient(baseUrl)).listAllotments({
    channelId: ids.channelId,
    roomTypeId: ids.roomTypeId,
    from: range.from,
    to: range.to,
  });
  return { rows: page.data.data, etag: page.etag ?? null };
}

export function ChannelAllotmentsScreen({ baseUrl }: { baseUrl: string }): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [options, setOptions] = useState<Options>(EMPTY_OPTIONS);
  const [target, setTarget] = useState<Target>(() => ({
    propertyId: '',
    channelId: '',
    roomTypeId: '',
    range: defaultRange(new Date()),
  }));
  const [pending, setPending] = useState<GridRange>(() => defaultRange(new Date()));
  const [drafts, setDrafts] = useState<readonly AllotmentDraftRow[]>([]);
  const [etag, setEtag] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const canEdit = state.kind !== 'forbidden';
  const roomType = options.roomTypes.find((item) => item.id === target.roomTypeId);
  const sellingUnits = roomType?.sellingUnits;

  const load = useCallback(
    async (wanted: Target): Promise<void> => {
      setReadError(null);
      const issues = validateDrafts([], undefined, wanted.range);
      if (issues.length > 0) {
        setState({ kind: 'validationError', details: issues });
        return;
      }
      try {
        const loaded = await fetchOptions(baseUrl, wanted);
        setOptions({
          properties: loaded.properties,
          roomTypes: loaded.roomTypes,
          channels: loaded.channels,
        });
        if (idsDiffer(wanted, loaded)) {
          setTarget({
            propertyId: loaded.propertyId,
            channelId: loaded.channelId,
            roomTypeId: loaded.roomTypeId,
            range: wanted.range,
          });
          return;
        }
        if (loaded.channelId === '' || loaded.roomTypeId === '') {
          setDrafts([]);
          setState({ kind: 'empty', reason: 'noData', canCreate: false });
          return;
        }
        const { rows, etag: readEtag } = await fetchRows(
          baseUrl,
          { channelId: loaded.channelId, roomTypeId: loaded.roomTypeId },
          wanted.range,
        );
        setDrafts(emptyRowsFor(wanted.range, rows));
        setEtag(readEtag);
        setState(
          rows.length === 0
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
    void load(target);
  }, [forced, load, target]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (etag === null) {
      // Không có ETag của lần đọc: gửi lệnh thiếu điều kiện sẽ bị 428 im lặng — báo rõ thay vì gửi.
      setState({
        kind: 'validationError',
        details: [{ field: '(biểu mẫu)', issue: 'MISSING_ETAG' }],
      });
      return;
    }
    const issues = validateDrafts(drafts, sellingUnits, target.range);
    if (issues.length > 0) {
      setState({ kind: 'validationError', details: issues });
      return;
    }
    const items = changedItems(drafts);
    if (items.length === 0) {
      setState({ kind: 'validationError', details: [{ field: '(biểu mẫu)', issue: 'UNCHANGED' }] });
      return;
    }
    try {
      await createInventoryApi(opsApiClient(baseUrl)).putAllotments(
        { channelId: target.channelId, roomTypeId: target.roomTypeId, items: [...items] },
        etag,
      );
      setSaved(items.length);
      await load(target);
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: etag,
          onReload: () => void load(target),
          onLookup: () => void load(target),
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
      <h1 style={{ margin: 0 }}>{t('allotments.title')}</h1>
      <p style={{ margin: 0 }}>{t('allotments.intro')}</p>
      <form
        data-testid="allotment-controls"
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(null);
          setTarget({ ...target, range: pending });
        }}
        style={ROW_STYLE}
      >
        <label style={{ display: 'grid', gap: 4 }}>
          {t('allotments.form.channel')}
          <select
            value={target.channelId}
            onChange={(event) => {
              setSaved(null);
              setTarget({ ...target, channelId: event.target.value });
            }}
          >
            {options.channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {t(`enum.channelCode.${channel.code}`)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('allotments.form.property')}
          <select
            value={target.propertyId}
            onChange={(event) => {
              setSaved(null);
              setTarget({
                propertyId: event.target.value,
                channelId: target.channelId,
                roomTypeId: '',
                range: target.range,
              });
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
          {t('allotments.form.roomType')}
          <select
            value={target.roomTypeId}
            onChange={(event) => {
              setSaved(null);
              setTarget({ ...target, roomTypeId: event.target.value });
            }}
          >
            {options.roomTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.code}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('allotments.form.from')}
          <input
            type="date"
            value={pending.from}
            onChange={(event) => setPending({ ...pending, from: event.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('allotments.form.to')}
          <input
            type="date"
            value={pending.to}
            onChange={(event) => setPending({ ...pending, to: event.target.value })}
          />
        </label>
        <button type="submit">{t('allotments.form.load')}</button>
      </form>
      {sellingUnits === undefined ? null : (
        <p role="note" style={{ margin: 0 }}>
          {t('allotments.unitsNote', { units: sellingUnits })}
        </p>
      )}
      <StateSurface state={state}>
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(target)} />
        )}
        {saved === null ? null : (
          <p role="status" data-testid="allotments-saved" style={{ margin: 0 }}>
            {t('allotments.saved', { count: saved })}
          </p>
        )}
        {drafts.length === 0 ? null : (
          <>
            <AllotmentTable
              rows={drafts}
              sellingUnits={sellingUnits}
              editable={canEdit}
              onChange={(index, value) => {
                setSaved(null);
                setDrafts(drafts.map((row, i) => (i === index ? { ...row, value } : row)));
              }}
            />
            {canEdit ? (
              <form onSubmit={(event) => void submit(event)} data-testid="allotment-editor">
                <button type="submit">{t('allotments.save')}</button>
              </form>
            ) : null}
          </>
        )}
      </StateSurface>
    </section>
  );
}
