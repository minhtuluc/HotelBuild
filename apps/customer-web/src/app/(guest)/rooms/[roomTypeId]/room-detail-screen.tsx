'use client';

/**
 * SCR-03 — chi tiết phòng & giá từng đêm (UC-RATE-05, BR-RATE-17, TC-RATE-21): chọn gói giá, gọi
 * `POST /quotes` và **in nguyên** bảng đêm/tổng hợp máy chủ trả. Báo giá hết hạn thì hướng dẫn lấy giá
 * mới bằng thao tác rõ ràng; màn hình **không** tự tính lại hay tự cập nhật giá.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ratePlanCodeSchema } from '@pinehill/contracts';
import type { Quote, RatePlanCode, RatePlanPublic } from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { t } from '../../../../lib/i18n';
import { fetchQuote, fetchRatePlans, type StayCriteria } from '../../search/journey-api';
import { criteriaIssue, parseCriteria } from '../../search/search-params';
import { isExpired } from './quote-model';
import { NightsTable, QuoteSummary, QuoteWarnings } from './quote-tables';

const FIELD_STYLE = { display: 'grid', gap: 4 } as const;

function planCodeOf(value: string): RatePlanCode | null {
  const parsed = ratePlanCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function RoomDetailScreen(): ReactElement {
  const routeParams = useParams<{ roomTypeId: string }>();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const roomTypeId = typeof routeParams.roomTypeId === 'string' ? routeParams.roomTypeId : '';

  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [plans, setPlans] = useState<readonly RatePlanPublic[]>([]);
  const [planCode, setPlanCode] = useState<RatePlanCode | ''>('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [readError, setReadError] = useState<unknown>(null);

  /** Gọi báo giá cho một gói cụ thể (người dùng đổi gói hoặc bấm "Lấy giá mới"). */
  const runQuote = useCallback(
    async (plan: RatePlanCode): Promise<void> => {
      const current = parseCriteria(new URLSearchParams(query));
      if (current === null || roomTypeId === '') return;
      setReadError(null);
      setState({ kind: 'loading' });
      try {
        const loaded = await fetchQuote({
          propertyId: current.propertyId,
          roomTypeId,
          channelCode: 'WEB',
          ratePlanCode: plan,
          checkIn: current.checkIn,
          checkOut: current.checkOut,
          adults: current.adults,
          children: current.children,
          roomCount: current.roomCount,
        });
        setQuote(loaded);
        setState({ kind: 'ready' });
      } catch (caught) {
        setReadError(caught);
        setState({ kind: 'ready' });
      }
    },
    [query, roomTypeId],
  );

  const load = useCallback(async (): Promise<void> => {
    const current: StayCriteria | null = parseCriteria(new URLSearchParams(query));
    if (current === null || roomTypeId === '') {
      setState({ kind: 'empty', reason: 'noData', canCreate: false });
      return;
    }
    setReadError(null);
    setState({ kind: 'loading' });
    try {
      const loaded = await fetchRatePlans(current);
      setPlans(loaded);
      const first = loaded[0] === undefined ? null : planCodeOf(loaded[0].code);
      if (first === null) {
        setState({ kind: 'empty', reason: 'noData', canCreate: false });
        return;
      }
      setPlanCode(first);
      await runQuote(first);
    } catch (caught) {
      setReadError(caught);
      setState({ kind: 'ready' });
    }
  }, [query, roomTypeId, runQuote]);

  useEffect(() => {
    void load();
  }, [load]);

  const criteria = parseCriteria(new URLSearchParams(query));
  if (criteria === null || roomTypeId === '') {
    const issue = criteriaIssue(new URLSearchParams(query));
    return (
      <section data-testid="room-detail" style={{ display: 'grid', gap: 'var(--space-s3, 12px)' }}>
        <h1 style={{ margin: 0 }}>{t('guest.rooms.title')}</h1>
        <p role="alert" style={{ margin: 0 }}>
          {t('guest.results.invalid', { field: issue.field })}
        </p>
        <Link href="/">{t('guest.results.backHome')}</Link>
      </section>
    );
  }

  const expired = quote !== null && isExpired(quote.expiresAt, Date.now());

  return (
    <section
      data-testid="room-detail"
      style={{ display: 'grid', gap: 'var(--space-s3, 12px)', padding: 'var(--space-s4, 16px) 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('guest.rooms.title')}</h1>
      <p style={{ margin: 0 }}>
        {t('guest.results.criteria', {
          from: criteria.checkIn,
          to: criteria.checkOut,
          nights: quote?.nights.length ?? 0,
        })}
      </p>
      <label style={FIELD_STYLE}>
        {t('guest.rooms.plan')}
        <select
          name="ratePlanCode"
          value={planCode}
          disabled={plans.length === 0}
          onChange={(event) => {
            const next = planCodeOf(event.target.value);
            if (next === null) return;
            setPlanCode(next);
            void runQuote(next);
          }}
        >
          {plans.map((plan) => (
            <option key={plan.code} value={plan.code}>
              {plan.name}
            </option>
          ))}
        </select>
      </label>
      <StateSurface state={state}>
        {readError === null ? null : (
          <div role="alert" style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}>
            <p style={{ margin: 0 }}>{t('guest.rooms.error')}</p>
            <button type="button" onClick={() => void load()} style={{ minHeight: 44 }}>
              {t('guest.results.retry')}
            </button>
          </div>
        )}
        {quote === null ? null : (
          <>
            {expired ? (
              <div role="alert" data-testid="quote-expired" style={{ display: 'grid', gap: 8 }}>
                <p style={{ margin: 0 }}>{t('guest.rooms.expired')}</p>
                <button
                  type="button"
                  onClick={() => {
                    if (planCode !== '') void runQuote(planCode);
                  }}
                  style={{ minHeight: 44 }}
                >
                  {t('guest.rooms.renew')}
                </button>
              </div>
            ) : null}
            <NightsTable quote={quote} />
            <QuoteWarnings quote={quote} />
            <QuoteSummary quote={quote} />
            <p role="note" style={{ margin: 0 }}>
              {t('guest.rooms.engine', { version: quote.engineVersion })}
            </p>
            <Link
              href={`/book?${new URLSearchParams({
                propertyId: criteria.propertyId,
                roomTypeId,
                ratePlanCode: planCode,
                checkIn: criteria.checkIn,
                checkOut: criteria.checkOut,
                adults: String(criteria.adults),
                children: String(criteria.children),
                roomCount: String(criteria.roomCount),
              }).toString()}`}
            >
              {t('guest.rooms.continue')}
            </Link>
          </>
        )}
      </StateSurface>
    </section>
  );
}
