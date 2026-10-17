'use client';

/**
 * SCR-26 — Lịch giá & giá cơ bản (UC-RATE-01, BR-RATE-02/03/04, BR-RBAC-04).
 * Đọc `GET /room-types/{id}/rate-calendar` và hiện **nguyên** giá/nguồn/mùa máy chủ trả: giao diện
 * không tự tính giá, không tự suy mùa thắng. Ghi đè bằng `PUT /room-types/{id}/rate-calendar`; ngày
 * lệch quá ±20% so với giá đang áp dụng phải tick xác nhận của OWNER trước khi gửi.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { createPropertyApi, createRateApi, isApiError, type ApiClient } from '@pinehill/api-client';
import type { PropertySummary, RoomTypeSummary } from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../components/screen-alert';
import { useForcedState } from '../../../components/forced-state';
import { useOpsSession } from '../../../lib/ops-session';
import { t } from '../../../lib/i18n';
import { dayCount, defaultRange } from '../../../lib/inventory-grid';
import { toMoney } from '../../../lib/money';
import {
  buildOverrideBody,
  planOverrides,
  validateSubmit,
  type RateEdit,
} from '../../../lib/rate-calendar';
import { VERSION_UNKNOWN, readFailureState, writeFailureState } from '../../../lib/screen-state';
import { RateCalendarTable, type RateDay } from './rate-calendar-table';

interface Filters {
  propertyId: string;
  roomTypeId: string;
  from: string;
  to: string;
}

interface LoadedCalendar {
  properties: readonly PropertySummary[];
  roomTypes: readonly RoomTypeSummary[];
  filters: Filters;
  days: readonly RateDay[];
  warnings: readonly string[];
}

/** Bộ lọc khởi tạo: 7 ngày kể từ ngày nghiệp vụ hiện tại (đồng hồ lấy ở thời điểm mở màn hình). */
function initialFilters(): Filters {
  return { propertyId: '', roomTypeId: '', ...defaultRange(new Date()) };
}

/**
 * Đọc cơ sở, loại phòng và lịch giá trong một khoảng. Không chọn gì thì chốt cơ sở/loại phòng đầu
 * tiên để màn hình luôn có dữ liệu xem được; số chọn được trả lại để bộ lọc khớp với dữ liệu đã tải.
 */
async function fetchCalendar(client: ApiClient, target: Filters): Promise<LoadedCalendar> {
  const propertyPage = await createPropertyApi(client).list();
  const properties = propertyPage.data.data;
  const propertyId = target.propertyId === '' ? (properties[0]?.id ?? '') : target.propertyId;
  if (propertyId === '') {
    return {
      properties,
      roomTypes: [],
      filters: { ...target, propertyId: '', roomTypeId: '' },
      days: [],
      warnings: [],
    };
  }
  const typePage = await createPropertyApi(client).listRoomTypes({ propertyId });
  const roomTypes = typePage.data.data;
  const roomTypeId = roomTypes.some((type) => type.id === target.roomTypeId)
    ? target.roomTypeId
    : (roomTypes[0]?.id ?? '');
  const filters: Filters = { ...target, propertyId, roomTypeId };
  if (roomTypeId === '') return { properties, roomTypes, filters, days: [], warnings: [] };
  const calendar = await createRateApi(client).rateCalendar(roomTypeId, {
    from: target.from,
    to: target.to,
  });
  return {
    properties,
    roomTypes,
    filters,
    days: calendar.data.entries.map((entry) => ({
      date: entry.date,
      price: entry.nightlyPrice,
      source: entry.source,
      seasonName: entry.seasonName,
    })),
    warnings: calendar.data.warnings ?? [],
  };
}

export function RateCalendarScreen(): ReactElement {
  const forced = useForcedState();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [properties, setProperties] = useState<readonly PropertySummary[]>([]);
  const [roomTypes, setRoomTypes] = useState<readonly RoomTypeSummary[]>([]);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(initialFilters);
  const [days, setDays] = useState<readonly RateDay[]>([]);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [prices, setPrices] = useState<Readonly<Record<string, string>>>({});
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState('0');
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const session = useOpsSession(['/properties', '/room-types'], {
    onExpired: () => setState({ kind: 'forbidden' }),
  });

  const load = useCallback(
    async (target: Filters): Promise<void> => {
      setReadError(null);
      if (dayCount(target.from, target.to) < 1) {
        setState({ kind: 'validationError', details: [{ field: 'to', issue: 'RANGE_INVALID' }] });
        return;
      }
      try {
        const loaded = await fetchCalendar(session.client, target);
        setProperties(loaded.properties);
        setRoomTypes(loaded.roomTypes);
        // Chỉ điền lựa chọn còn trống; không ghi đè khoảng ngày người dùng đang gõ.
        setFilters((current) => ({
          ...current,
          propertyId: current.propertyId === '' ? loaded.filters.propertyId : current.propertyId,
          roomTypeId: current.roomTypeId === '' ? loaded.filters.roomTypeId : current.roomTypeId,
        }));
        setDays(loaded.days);
        setWarnings(loaded.warnings);
        setPrices({});
        setState(
          loaded.days.length === 0
            ? { kind: 'empty', reason: 'noData', canCreate: false }
            : { kind: 'ready' },
        );
      } catch (caught) {
        const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
        if (mapped !== undefined) {
          setState(mapped);
          return;
        }
        // Giữ nguyên lịch đang xem; băng lỗi nói rõ chưa đọc được thay vì hiện "chưa có dữ liệu".
        setReadError(caught);
        setState({ kind: 'ready' });
      }
    },
    [session],
  );

  useEffect(() => {
    if (forced !== undefined) return;
    void load(applied);
  }, [forced, load, applied]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (filters.roomTypeId === '') {
      setState({ kind: 'validationError', details: [{ field: 'roomTypeId', issue: 'REQUIRED' }] });
      return;
    }
    const edits: RateEdit[] = [];
    for (const day of days) {
      const typed = prices[day.date] ?? '';
      if (typed.trim() === '') continue;
      const next = toMoney(typed);
      if (next === null) {
        setState({
          kind: 'validationError',
          details: [{ field: day.date, issue: 'INVALID_MONEY' }],
        });
        return;
      }
      edits.push({ date: day.date, currentPrice: day.price, nextPrice: next });
    }
    const check = validateSubmit({ edits, reason, confirmLarge, priority });
    if (!check.ok) {
      // Chặn tại chỗ: lệch quá ±20% mà chưa xác nhận thì **không** gọi API (BR-RBAC-04).
      setState({ kind: 'validationError', details: check.details });
      return;
    }
    const plan = planOverrides(edits);
    const api = createRateApi(session.client);
    const options = { priority: Number(priority), reason: reason.trim(), confirmLarge };
    try {
      // Ngày cùng giá đi chung một lệnh; ngày khác giá đi lệnh riêng, mỗi lệnh một khoá idempotency.
      for (const order of plan.orders) {
        await api.putRateCalendar(filters.roomTypeId, buildOverrideBody(order, options));
      }
      setSaved(plan.edited.length);
      setReason('');
      setPriority('0');
      setConfirmLarge(false);
      await load(applied);
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: VERSION_UNKNOWN,
          onReload: () => void load(applied),
          onLookup: () => void load(applied),
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

  const selectedType = roomTypes.find((type) => type.id === filters.roomTypeId);
  return (
    <section
      style={{ padding: 'var(--space-s6, 24px)', display: 'grid', gap: 'var(--space-s4, 16px)' }}
    >
      <h1 style={{ margin: 0 }}>{t('rate.title')}</h1>
      <p style={{ margin: 0 }}>{t('rate.intro')}</p>
      <div
        style={{
          display: 'grid',
          gap: 'var(--space-s2, 8px)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
          maxWidth: 760,
          minWidth: 0,
        }}
      >
        <label style={{ display: 'grid', gap: 4 }}>
          {t('rate.form.property')}
          <select
            value={filters.propertyId}
            onChange={(event) => {
              setFilters({ ...filters, propertyId: event.target.value, roomTypeId: '' });
            }}
          >
            {properties.length === 0 ? <option value="">{t('rate.none')}</option> : null}
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('rate.form.roomType')}
          <select
            value={filters.roomTypeId}
            onChange={(event) => {
              setFilters({ ...filters, roomTypeId: event.target.value });
            }}
          >
            {roomTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.code}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('rate.form.from')}
          <input
            type="date"
            value={filters.from}
            onChange={(event) => {
              setFilters({ ...filters, from: event.target.value });
            }}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('rate.form.to')}
          <input
            type="date"
            value={filters.to}
            onChange={(event) => {
              setFilters({ ...filters, to: event.target.value });
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-s2, 8px)', alignItems: 'end' }}>
          <button
            type="button"
            onClick={() => {
              setSaved(null);
              setApplied({ ...filters });
            }}
            style={{ minHeight: 44 }}
          >
            {t('rate.form.load')}
          </button>
          <button
            type="button"
            onClick={() => {
              // Mốc "cập nhật lúc" chỉ để hiển thị ở giao diện, không phải thời gian nghiệp vụ.
              setState({ kind: 'refreshing', updatedAt: new Date().toISOString(), stale: false });
              setApplied({ ...applied });
            }}
            style={{ minHeight: 44 }}
          >
            {t('rate.reload')}
          </button>
        </div>
      </div>
      <StateSurface state={state}>
        {saved === null ? null : (
          <p role="status" data-testid="rate-save-success" style={{ margin: 0 }}>
            {t('rate.saved', { days: saved })}
          </p>
        )}
        {readError === null ? null : (
          <ScreenAlert error={readError} onRetry={() => void load(applied)} />
        )}
        {warnings.length === 0 ? null : (
          <div data-testid="rate-warnings">
            <h2 style={{ fontSize: 'var(--text-h2, 18px)', margin: 0 }}>{t('rate.warnings')}</h2>
            <ul>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        {days.length === 0 ? null : (
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            style={{ display: 'grid', gap: 'var(--space-s3, 12px)' }}
          >
            <RateCalendarTable
              days={days}
              prices={prices}
              onPriceChange={(date, value) => {
                setPrices((current) => ({ ...current, [date]: value }));
              }}
              minPrice={selectedType?.minPrice}
              maxPrice={selectedType?.maxPrice}
            />
            <label style={{ display: 'grid', gap: 4, maxWidth: 320 }}>
              {t('rate.form.priority')}
              <input
                type="number"
                min={0}
                name="priority"
                value={priority}
                onChange={(event) => {
                  setPriority(event.target.value);
                }}
                style={{ minHeight: 44 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, maxWidth: 480 }}>
              {t('rate.form.reason')}
              <input
                type="text"
                name="reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                style={{ minHeight: 44 }}
              />
            </label>
            <label style={{ display: 'flex', gap: 'var(--space-s2, 8px)', alignItems: 'center' }}>
              <input
                type="checkbox"
                name="confirmLarge"
                checked={confirmLarge}
                onChange={(event) => {
                  setConfirmLarge(event.target.checked);
                }}
                style={{ minWidth: 24, minHeight: 24 }}
              />
              {t('rate.form.confirmLarge')}
            </label>
            <button type="submit" style={{ minHeight: 44, justifySelf: 'start' }}>
              {t('rate.form.save')}
            </button>
          </form>
        )}
      </StateSurface>
    </section>
  );
}
