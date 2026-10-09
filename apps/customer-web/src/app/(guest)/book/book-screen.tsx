'use client';

/**
 * SCR-04 (chọn gói) + SCR-05 (thông tin khách & xác nhận) — bước **4/4** của journey khách (NFR-USE-05:
 * tổng số bước bắt buộc ≤ 4). Điều khoản huỷ của gói hiển thị **trước** khi xác nhận; máy chủ nghi trùng
 * booking thì hỏi khách (mở booking cũ hay quay lại chỉnh thông tin) thay vì tự tạo thêm.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSessionClient } from '@pinehill/web-session/client';
import Link from 'next/link';
import { ratePlanCodeSchema } from '@pinehill/contracts';
import type { BookingSummary, Quote, RatePlanCode, RatePlanPublic } from '@pinehill/contracts';
import { StateSurface, formatMoney, type ScreenState } from '@pinehill/ui-web';
import { t } from '../../../lib/i18n';
import { fetchRatePlans, type StayCriteria } from '../search/journey-api';
import { criteriaIssue, parseCriteria } from '../search/search-params';
import { QuoteSummary } from '../rooms/[roomTypeId]/quote-tables';
import { createBooking, fetchQuoteWithSession } from './booking-api';
import {
  JOURNEY_STEPS,
  duplicateChoices,
  guestIssues,
  planTerms,
  type GuestDraft,
  type PlanTerms,
} from './book-model';

const FIELD_STYLE = { display: 'grid', gap: 4 } as const;
const EMPTY_GUEST: GuestDraft = { fullName: '', phone: '', note: '' };

function planCodeOf(value: string): RatePlanCode | null {
  const parsed = ratePlanCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function TermsPanel({ terms }: { terms: PlanTerms }): ReactElement {
  return (
    <div data-testid="plan-terms" style={{ display: 'grid', gap: 4 }}>
      <h2 style={{ margin: 0, fontSize: 'var(--text-h2, 18px)' }}>{t('guest.book.terms.title')}</h2>
      <p style={{ margin: 0 }}>
        {t('guest.book.terms.deposit', { percent: terms.depositPercent })}
      </p>
      <p style={{ margin: 0 }}>
        {terms.freeCancelHours === null
          ? t('guest.book.terms.freeCancelUnknown')
          : t('guest.book.terms.freeCancel', { hours: terms.freeCancelHours })}
      </p>
      <p style={{ margin: 0 }}>
        {t('guest.book.terms.nights', { min: terms.minNights, max: terms.maxNights })}
      </p>
    </div>
  );
}

function DuplicatePanel({
  booking,
  onKeepEditing,
}: {
  booking: BookingSummary;
  onKeepEditing: () => void;
}): ReactElement {
  return (
    <div role="alert" data-testid="duplicate-prompt" style={{ display: 'grid', gap: 8 }}>
      <p style={{ margin: 0 }}>{t('guest.book.duplicate', { code: booking.code })}</p>
      <Link href={duplicateChoices(booking.id).openHref}>{t('guest.book.duplicate.open')}</Link>
      <button type="button" onClick={onKeepEditing} style={{ minHeight: 44 }}>
        {t('guest.book.duplicate.keepEditing')}
      </button>
    </div>
  );
}

function ErrorPanel({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <div role="alert" style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}>
      <p style={{ margin: 0 }}>{t('guest.book.error')}</p>
      <button type="button" onClick={onRetry} style={{ minHeight: 44 }}>
        {t('guest.results.retry')}
      </button>
    </div>
  );
}

function GuestForm({
  quote,
  guest,
  onChange,
  onSubmit,
}: {
  quote: Quote;
  guest: GuestDraft;
  onChange: (guest: GuestDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): ReactElement {
  return (
    <form
      data-testid="guest-form"
      onSubmit={onSubmit}
      style={{ display: 'grid', gap: 'var(--space-s2, 8px)', maxWidth: 480 }}
    >
      <label style={FIELD_STYLE}>
        {t('guest.book.fullName')}
        <input
          name="fullName"
          value={guest.fullName}
          onChange={(event) => onChange({ ...guest, fullName: event.target.value })}
        />
      </label>
      <label style={FIELD_STYLE}>
        {t('guest.book.phone')}
        <input
          name="phone"
          value={guest.phone}
          onChange={(event) => onChange({ ...guest, phone: event.target.value })}
        />
      </label>
      <label style={FIELD_STYLE}>
        {t('guest.book.note')}
        <input
          name="note"
          value={guest.note}
          onChange={(event) => onChange({ ...guest, note: event.target.value })}
        />
      </label>
      <p role="note" style={{ margin: 0 }}>
        {t('guest.book.payNote', { amount: formatMoney(quote.depositAmount) })}
      </p>
      <button type="submit" style={{ minHeight: 44 }}>
        {t('guest.book.submit')}
      </button>
    </form>
  );
}

function BookFlow({
  query,
  roomTypeId,
  wantedPlan,
}: {
  query: string;
  roomTypeId: string;
  wantedPlan: RatePlanCode | null;
}): ReactElement {
  const router = useRouter();

  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [plans, setPlans] = useState<readonly RatePlanPublic[]>([]);
  const [planCode, setPlanCode] = useState<RatePlanCode | ''>('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [guest, setGuest] = useState<GuestDraft>(EMPTY_GUEST);
  const [duplicate, setDuplicate] = useState<BookingSummary | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  // Phiên khách dùng cho lệnh ghi (đặt phòng): BFF lấy access token từ session client này.
  const session = useMemo(() => createSessionClient({ kind: 'guest' }), []);

  const runQuote = useCallback(
    async (plan: RatePlanCode): Promise<void> => {
      const current = parseCriteria(new URLSearchParams(query));
      if (current === null || roomTypeId === '') return;
      setReadError(null);
      setState({ kind: 'loading' });
      try {
        const loaded = await fetchQuoteWithSession(session, {
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
    [query, roomTypeId, session],
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
      const preferred = loaded.find((plan) => plan.code === wantedPlan);
      const chosen = preferred === undefined ? loaded[0] : preferred;
      const code = chosen === undefined ? null : planCodeOf(chosen.code);
      if (code === null) {
        setState({ kind: 'empty', reason: 'noData', canCreate: false });
        return;
      }
      setPlanCode(code);
      await runQuote(code);
    } catch (caught) {
      setReadError(caught);
      setState({ kind: 'ready' });
    }
  }, [query, roomTypeId, runQuote, wantedPlan]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => session.dispose(), [session]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const issues = guestIssues(guest);
    if (issues.length > 0) {
      setState({ kind: 'validationError', details: issues });
      return;
    }
    const current = parseCriteria(new URLSearchParams(query));
    if (quote === null || current === null || planCode === '') return;
    try {
      const booking = await createBooking(session, {
        propertyId: current.propertyId,
        roomTypeId,
        ratePlanCode: planCode,
        channelCode: 'WEB',
        quoteId: quote.quoteId,
        guest: { fullName: guest.fullName.trim(), phone: guest.phone.trim() },
        checkIn: current.checkIn,
        checkOut: current.checkOut,
        adults: current.adults,
        children: current.children,
        roomCount: current.roomCount,
        ...(guest.note.trim() === '' ? {} : { note: guest.note.trim() }),
      });
      if (booking.duplicateSuspected) {
        setDuplicate(booking);
        return;
      }
      router.push(`/booking/${encodeURIComponent(booking.id)}`);
    } catch (caught) {
      setReadError(caught);
      setState({ kind: 'ready' });
    }
  };

  const selected = plans.find((plan) => plan.code === planCode) ?? null;

  return (
    <section
      data-testid="book-screen"
      style={{ display: 'grid', gap: 'var(--space-s3, 12px)', padding: 'var(--space-s4, 16px) 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('guest.book.title')}</h1>
      <p role="note" style={{ margin: 0 }} data-testid="book-step">
        {t('guest.book.step', { current: JOURNEY_STEPS.length, total: JOURNEY_STEPS.length })}
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
        {readError === null ? null : <ErrorPanel onRetry={() => void load()} />}
        {selected === null ? null : <TermsPanel terms={planTerms(selected)} />}
        {duplicate === null ? null : (
          <DuplicatePanel booking={duplicate} onKeepEditing={() => setDuplicate(null)} />
        )}
        {quote === null ? null : (
          <GuestForm
            quote={quote}
            guest={guest}
            onChange={setGuest}
            onSubmit={(event) => void submit(event)}
          />
        )}
        {quote === null ? null : <QuoteSummary quote={quote} />}
      </StateSurface>
    </section>
  );
}

function InvalidPanel({ query }: { query: string }): ReactElement {
  const issue = criteriaIssue(new URLSearchParams(query));
  return (
    <section data-testid="book-screen" style={{ display: 'grid', gap: 'var(--space-s3, 12px)' }}>
      <h1 style={{ margin: 0 }}>{t('guest.book.title')}</h1>
      <p role="alert" style={{ margin: 0 }}>
        {t('guest.results.invalid', { field: issue.field })}
      </p>
      <Link href="/">{t('guest.results.backHome')}</Link>
    </section>
  );
}

export function BookScreen(): ReactElement {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const roomTypeId = searchParams.get('roomTypeId')?.trim() ?? '';
  const criteria = parseCriteria(new URLSearchParams(query));
  if (criteria === null || roomTypeId === '') return <InvalidPanel query={query} />;
  return (
    <BookFlow
      query={query}
      roomTypeId={roomTypeId}
      wantedPlan={planCodeOf(searchParams.get('ratePlanCode') ?? '')}
    />
  );
}
