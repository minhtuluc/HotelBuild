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
import { t } from '../../../lib/i18n';
import { fetchAvailability } from './journey-api';
import { criteriaIssue, detailHref, parseCriteria } from './search-params';

const CELL = { textAlign: 'start', borderBottom: '1px solid var(--color-border)' } as const;

export function SearchResultsScreen(): ReactElement {
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
      <section
        data-testid="search-results"
        style={{ display: 'grid', gap: 'var(--space-s3, 12px)' }}
      >
        <h1 style={{ margin: 0 }}>{t('guest.results.title')}</h1>
        <p role="alert" style={{ margin: 0 }}>
          {t('guest.results.invalid', { field: issue.field })}
        </p>
        <Link href="/">{t('guest.results.backHome')}</Link>
      </section>
    );
  }

  return (
    <section
      data-testid="search-results"
      style={{ display: 'grid', gap: 'var(--space-s3, 12px)', padding: 'var(--space-s4, 16px) 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('guest.results.title')}</h1>
      <p style={{ margin: 0 }}>
        {t('guest.results.criteria', {
          from: criteria.checkIn,
          to: criteria.checkOut,
          nights: availability?.nights ?? availability?.data.length ?? 0,
        })}
      </p>
      <StateSurface state={state}>
        {readError === null ? null : (
          <div role="alert" style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}>
            <p style={{ margin: 0 }}>{t('guest.results.error')}</p>
            <button type="button" onClick={() => void load()} style={{ minHeight: 44 }}>
              {t('guest.results.retry')}
            </button>
          </div>
        )}
        {availability === null || availability.data.length === 0 ? null : (
          <div style={{ overflowX: 'auto' }}>
            <table
              data-testid="availability-table"
              style={{ width: '100%', borderCollapse: 'collapse' }}
            >
              <caption style={{ textAlign: 'start', padding: 'var(--space-s2, 8px) 0' }}>
                {t('guest.results.table')}
              </caption>
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
                    <th key={label} scope="col" style={CELL}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {availability.data.map((item) => (
                  <tr key={item.roomTypeId} data-testid={`availability-row-${item.roomTypeId}`}>
                    <td style={CELL}>
                      {item.roomTypeName} ({item.roomTypeCode})
                    </td>
                    <td style={CELL}>{item.capacityAdults}</td>
                    <td style={CELL}>
                      {item.soldOut ? t('guest.results.soldOut') : item.availableCount}
                    </td>
                    <td style={CELL}>
                      {t('guest.results.nightsRange', { min: item.minNights, max: item.maxNights })}
                    </td>
                    <td style={CELL}>{formatMoney(item.nightlyFrom)}</td>
                    <td style={CELL}>{formatMoney(item.totalFrom)}</td>
                    <td style={CELL}>
                      <Link href={detailHref(criteria, item.roomTypeId)}>
                        {t('guest.results.openDetail')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </StateSurface>
    </section>
  );
}
