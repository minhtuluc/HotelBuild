'use client';

/**
 * SCR-02 — kết quả tìm phòng (UC-INV-02, BR-INV-01/07): danh sách loại phòng còn chỗ cho **cả kỳ**
 * (máy chủ trả `availableCount` đã là min toàn kỳ) kèm giá từ/đêm, tổng từ và số đêm min–max của loại.
 * Không tự tính giá ở màn hình này.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { formatMoney, StateSurface, type ScreenState } from '@pinehill/ui-web';
import type { Availability } from '@pinehill/contracts';
import { useLocale, useT } from '../../../i18n/client';
import { fetchAvailability, type StayCriteria } from './journey-api';
import { criteriaIssue, detailHref, parseCriteria } from './search-params';
import { RoomCodeStamp } from '../../../components/stamps';
import { calendarDate } from '../../../i18n/format';

function AvailabilityTable({
  availability,
  criteria,
  photos,
}: {
  availability: Availability;
  criteria: StayCriteria;
  photos: Readonly<Record<string, string>>;
}): ReactElement {
  const t = useT();
  return (
    <div className="ph-table-wrap ph-availability-wrap">
      <table data-testid="availability-table" className="ph-availability-table">
        <caption>{t('guest.results.table')}</caption>
        <thead>
          <tr>
            {[
              t('guest.results.col.room'),
              t('guest.results.col.capacity'),
              t('guest.results.col.available'),
              t('guest.results.col.nights'),
              t('guest.results.col.nightlyFrom'),
              t('guest.results.col.totalFrom'),
              t('guest.results.col.actions'),
            ].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {availability.data.map((item) => (
            <tr key={item.roomTypeId} data-testid={`availability-row-${item.roomTypeId}`}>
              <td className="ph-availability-room">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {photos[`hang-${item.roomTypeCode}`] === undefined ? null : (
                    <img
                      className="ph-room-thumb"
                      src={photos[`hang-${item.roomTypeCode}`]}
                      alt=""
                      width={80}
                      height={60}
                      loading="lazy"
                    />
                  )}
                  <RoomCodeStamp
                    code={item.roomTypeCode}
                    capacityLabel={t('guest.results.capacityShort', {
                      capacity: item.capacityAdults,
                    })}
                    label={t('guest.results.roomCode', {
                      code: item.roomTypeCode,
                      capacity: item.capacityAdults,
                    })}
                  />
                  <span className="ph-availability-room-name" style={{ fontWeight: 600 }}>
                    {item.roomTypeName} ({item.roomTypeCode})
                  </span>
                </div>
              </td>
              <td className="ph-tabular" data-label={t('guest.results.col.capacity')}>
                {item.capacityAdults}
              </td>
              <td className="ph-tabular" data-label={t('guest.results.col.available')}>
                {item.soldOut ? t('guest.results.soldOut') : item.availableCount}
              </td>
              <td className="ph-tabular" data-label={t('guest.results.col.nights')}>
                {t('guest.results.nightsRange', { min: item.minNights, max: item.maxNights })}
              </td>
              <td className="ph-tabular" data-label={t('guest.results.col.nightlyFrom')}>
                {formatMoney(item.nightlyFrom)}
              </td>
              <td
                className="ph-tabular"
                data-label={t('guest.results.col.totalFrom')}
                style={{ fontWeight: 600 }}
              >
                {formatMoney(item.totalFrom)}
              </td>
              <td className="ph-availability-action">
                <Link href={detailHref(criteria, item.roomTypeId)} className="ph-btn-accent">
                  {t('guest.results.openDetail')}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SearchResultsScreen({
  photos = {},
}: {
  /** Ảnh hạng phòng đang có (mã ô `hang-<CODE>` → đường dẫn), do trang máy chủ đọc từ `public/`. */
  photos?: Readonly<Record<string, string>>;
}): ReactElement {
  const locale = useLocale();
  const t = useT();
  const params = useSearchParams();
  const query = params.toString();
  const criteria = parseCriteria(new URLSearchParams(query));
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [readError, setReadError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    const current = parseCriteria(new URLSearchParams(query));
    if (current === null) {
      setState({ kind: 'empty', reason: 'noData', canCreate: false });
      return;
    }
    setReadError(null);
    setState({ kind: 'loading' });
    try {
      const loaded = await fetchAvailability(current);
      setAvailability(loaded);
      setState(
        loaded.data.length === 0
          ? { kind: 'empty', reason: 'soldOut', canCreate: false }
          : { kind: 'ready' },
      );
    } catch (caught) {
      setReadError(caught);
      setState({ kind: 'ready' });
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  if (criteria === null) {
    const issue = criteriaIssue(new URLSearchParams(query));
    return (
      <section data-testid="search-results" className="ph-page-shell">
        <div className="ph-page-header">
          <h1 className="ph-page-title">{t('guest.results.title')}</h1>
        </div>
        <div className="ph-alert-box">
          <p role="alert" style={{ margin: 0 }}>
            {t('guest.results.invalid', { field: issue.field })}
          </p>
          <Link href="/" className="ph-btn">
            {t('guest.results.backHome')}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="search-results" className="ph-page-shell">
      <div className="ph-page-header">
        <h1 className="ph-page-title">{t('guest.results.title')}</h1>
        <p className="ph-tabular" style={{ margin: 0, color: 'var(--color-textMuted)' }}>
          {t('guest.results.criteria', {
            from: calendarDate(criteria.checkIn, locale),
            to: calendarDate(criteria.checkOut, locale),
            nights: availability?.nights ?? availability?.data.length ?? 0,
          })}
        </p>
      </div>
      <StateSurface state={state}>
        {readError === null ? null : (
          <div role="alert" className="ph-alert-box">
            <p style={{ margin: 0 }}>{t('guest.results.error')}</p>
            <button type="button" className="ph-btn" onClick={() => void load()}>
              {t('guest.results.retry')}
            </button>
          </div>
        )}
        {availability === null || availability.data.length === 0 ? null : (
          <AvailabilityTable availability={availability} criteria={criteria} photos={photos} />
        )}
      </StateSurface>
    </section>
  );
}
