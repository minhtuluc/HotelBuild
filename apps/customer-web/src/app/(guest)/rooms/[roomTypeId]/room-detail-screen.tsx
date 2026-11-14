'use client';

/**
 * SCR-03 — chi tiết phòng & giá từng đêm (UC-RATE-05, BR-RATE-17, TC-RATE-21): chọn gói giá, gọi
 * `POST /quotes` và **in nguyên** bảng đêm/tổng hợp máy chủ trả. Báo giá hết hạn thì hướng dẫn lấy giá
 * mới bằng thao tác rõ ràng; màn hình **không** tự tính lại hay tự cập nhật giá.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { ratePlanCodeSchema } from '@pinehill/contracts';
import type { Quote, RatePlanCode, RatePlanPublic } from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { useLocale, useT } from '../../../../i18n/client';
import { fetchQuote, fetchRatePlans, type StayCriteria } from '../../search/journey-api';
import { criteriaIssue, parseCriteria } from '../../search/search-params';
import { isExpired } from './quote-model';
import { NightsTable, PriceStrip, QuoteSummary, QuoteWarnings } from './quote-tables';
import { calendarDate } from '../../../../i18n/format';
import { TableSkeleton } from '../../../../components/table-skeleton';
import { useLocalePath } from '../../../../i18n/client';

function planCodeOf(value: string): RatePlanCode | null {
  const parsed = ratePlanCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function bookHref(criteria: StayCriteria, roomTypeId: string, planCode: RatePlanCode | ''): string {
  return `/book?${new URLSearchParams({
    propertyId: criteria.propertyId,
    roomTypeId,
    ratePlanCode: planCode,
    checkIn: criteria.checkIn,
    checkOut: criteria.checkOut,
    adults: String(criteria.adults),
    children: String(criteria.children),
    roomCount: String(criteria.roomCount),
  }).toString()}`;
}

function RoomPlanHeader({
  plans,
  planCode,
  onSelectPlan,
}: {
  plans: readonly RatePlanPublic[];
  planCode: RatePlanCode | '';
  onSelectPlan: (code: RatePlanCode) => void;
}): ReactElement {
  const t = useT();
  return (
    <div>
      <div className="ph-card" style={{ display: 'grid', gap: 16, maxWidth: 520 }}>
        <label className="ph-field">
          {t('guest.rooms.plan')}
          <select
            name="ratePlanCode"
            value={planCode}
            disabled={plans.length === 0}
            onChange={(event) => {
              const next = planCodeOf(event.target.value);
              if (next !== null) onSelectPlan(next);
            }}
          >
            {plans.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

export function RoomDetailScreen(): ReactElement {
  const localPath = useLocalePath();
  const locale = useLocale();
  const t = useT();
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
      <section data-testid="room-detail" className="ph-page-shell">
        <div className="ph-page-header">
          <h1 className="ph-page-title">{t('guest.rooms.title')}</h1>
        </div>
        <div className="ph-alert-box">
          <p role="alert" style={{ margin: 0 }}>
            {t('guest.results.invalid', { field: issue.field })}
          </p>
          <Link href={localPath('/')} className="ph-btn">
            {t('guest.results.backHome')}
          </Link>
        </div>
      </section>
    );
  }

  const expired = quote !== null && isExpired(quote.expiresAt, Date.now());

  return (
    <section data-testid="room-detail" className="ph-page-shell">
      <div className="ph-page-header">
        <h1 className="ph-page-title">{t('guest.rooms.title')}</h1>
        <p className="ph-tabular" style={{ margin: 0, color: 'var(--color-textMuted)' }}>
          {t('guest.results.criteria', {
            from: calendarDate(criteria.checkIn, locale),
            to: calendarDate(criteria.checkOut, locale),
            nights: quote?.nights.length ?? 0,
          })}
        </p>
      </div>
      <RoomPlanHeader
        plans={plans}
        planCode={planCode}
        onSelectPlan={(next) => {
          setPlanCode(next);
          void runQuote(next);
        }}
      />
      <TableSkeleton
        active={state.kind === 'loading'}
        rows={3}
        columns={4}
        testId="nights-skeleton"
      />
      <StateSurface state={state}>
        {readError === null ? null : (
          <div role="alert" className="ph-alert-box">
            <p style={{ margin: 0 }}>{t('guest.rooms.error')}</p>
            <button type="button" className="ph-btn" onClick={() => void load()}>
              {t('guest.results.retry')}
            </button>
          </div>
        )}
        {quote === null ? null : (
          <div style={{ display: 'grid', gap: 20 }}>
            {expired ? (
              <div role="alert" data-testid="quote-expired" className="ph-alert-box">
                <p style={{ margin: 0 }}>{t('guest.rooms.expired')}</p>
                <button
                  type="button"
                  className="ph-btn"
                  onClick={() => {
                    if (planCode !== '') void runQuote(planCode);
                  }}
                >
                  {t('guest.rooms.renew')}
                </button>
              </div>
            ) : null}
            <PriceStrip quote={quote} />
            <div className="ph-two-col">
              <div style={{ display: 'grid', gap: 16 }}>
                <NightsTable quote={quote} />
                <QuoteWarnings quote={quote} />
              </div>
              <div style={{ display: 'grid', gap: 16 }}>
                <QuoteSummary quote={quote} />
                <p role="note" style={{ margin: 0, fontSize: 13, color: 'var(--color-textMuted)' }}>
                  {t('guest.rooms.engine', { version: quote.engineVersion })}
                </p>
                <Link
                  href={bookHref(criteria, roomTypeId, planCode)}
                  className="ph-btn-accent ph-btn-lg"
                  style={{ width: '100%' }}
                >
                  {t('guest.rooms.continue')}
                </Link>
              </div>
            </div>
          </div>
        )}
      </StateSurface>
    </section>
  );
}
