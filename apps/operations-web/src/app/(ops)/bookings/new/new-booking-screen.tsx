'use client';

/**
 * SCR-33 + SCR-34 (HB-107) — tạo booking tại quầy / qua điện thoại cho back-office.
 *
 * Luồng **5 bước** (kênh → phòng & gói → khách → xác nhận → kết quả): mỗi bước kiểm tại chỗ rồi mới đi
 * tiếp. Giá hiển thị **theo báo giá** (`POST /quotes` đúng kênh WALKIN/PHONE); số phút giữ chỗ của kênh
 * PHONE lấy từ `GET /channels` (`holdMinutes`) chứ không hard-code. Thu cọc và gửi xác nhận thuộc
 * SCR-37/SCR-51 — màn hình nói rõ thay vì dựng luồng giả.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  createBookingApi,
  createGuestApi,
  createInventoryApi,
  createQuoteApi,
  createRateApi,
} from '@pinehill/api-client';
import type {
  Availability,
  BookingSummary,
  ChannelSummary,
  GuestSummary,
  Quote,
  RatePlanPublic,
} from '@pinehill/contracts';
import { StateSurface, type ScreenState } from '@pinehill/ui-web';
import { ScreenAlert } from '../../../../components/screen-alert';
import { useForcedState } from '../../../../components/forced-state';
import { useOpsSession } from '../../../../lib/ops-session';
import { t } from '../../../../lib/i18n';
import { writeFailureState } from '../../../../lib/screen-state';
import { ChannelStep, ConfirmStep, DoneStep, GuestStep, RoomStep } from './new-booking-steps';
import {
  EMPTY_DRAFT,
  bookingRequestOf,
  holdMinutesOf,
  nextStep,
  previousStep,
  quoteRequestOf,
  stepIssue,
  type NewBookingDraft,
  type Step,
  type StepIssue,
} from './new-booking-model';

const ISSUE_KEYS: Readonly<
  Record<
    StepIssue,
    | 'newBooking.issue.PROPERTY'
    | 'newBooking.issue.DATES'
    | 'newBooking.issue.ROOM'
    | 'newBooking.issue.NAME'
    | 'newBooking.issue.PHONE'
  >
> = {
  PROPERTY: 'newBooking.issue.PROPERTY',
  DATES: 'newBooking.issue.DATES',
  ROOM: 'newBooking.issue.ROOM',
  NAME: 'newBooking.issue.NAME',
  PHONE: 'newBooking.issue.PHONE',
};

interface StepBodyProps {
  readonly step: Step;
  readonly draft: NewBookingDraft;
  readonly channels: readonly ChannelSummary[];
  readonly rooms: Availability | null;
  readonly plans: readonly RatePlanPublic[];
  readonly quote: Quote | null;
  readonly guest: GuestSummary | null;
  readonly booking: BookingSummary | null;
  readonly onChange: (patch: Partial<NewBookingDraft>) => void;
  readonly onLookup: () => void;
  readonly onPrint: () => void;
}

function StepBody(props: StepBodyProps): ReactElement {
  if (props.step === 'channel')
    return <ChannelStep draft={props.draft} channels={props.channels} onChange={props.onChange} />;
  if (props.step === 'room')
    return (
      <RoomStep
        draft={props.draft}
        rooms={props.rooms}
        plans={props.plans}
        onChange={props.onChange}
      />
    );
  if (props.step === 'guest')
    return (
      <GuestStep
        draft={props.draft}
        found={props.guest}
        onChange={props.onChange}
        onLookup={props.onLookup}
      />
    );
  if (props.step === 'done')
    return props.booking === null ? (
      <p role="status" style={{ margin: 0 }}>
        {t('newBooking.done.title')}
      </p>
    ) : (
      <DoneStep booking={props.booking} onPrint={props.onPrint} />
    );
  return (
    <ConfirmStep
      draft={props.draft}
      quote={props.quote}
      holdMinutes={holdMinutesOf(props.channels, props.draft.channel)}
    />
  );
}

export function NewBookingScreen(): ReactElement {
  const forced = useForcedState();
  const session = useOpsSession(
    ['/bookings', '/channels', '/guests', '/inventory', '/quotes', '/rate-plans'],
    { onExpired: () => setState({ kind: 'forbidden' }) },
  );
  const api = useMemo(() => {
    const client = session.client;
    return {
      rate: createRateApi(client),
      inventory: createInventoryApi(client),
      quotes: createQuoteApi(client),
      guests: createGuestApi(client),
      bookings: createBookingApi(client),
    };
  }, [session]);

  const [state, setState] = useState<ScreenState>({ kind: 'ready' });
  const [step, setStep] = useState<Step>('channel');
  const [draft, setDraft] = useState<NewBookingDraft>(EMPTY_DRAFT);
  const [channels, setChannels] = useState<readonly ChannelSummary[]>([]);
  const [rooms, setRooms] = useState<Availability | null>(null);
  const [plans, setPlans] = useState<readonly RatePlanPublic[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [guest, setGuest] = useState<GuestSummary | null>(null);
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [issue, setIssue] = useState<StepIssue | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Cấu hình kênh (holdMinutes) — cần cho cả hiển thị bước 1 và bước xác nhận.
  useEffect(() => {
    if (forced !== undefined) return;
    let cancelled = false;
    void api.rate
      .listChannels()
      .then((response) => {
        if (!cancelled) setChannels(response.data.data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, [api, forced]);

  const change = useCallback((patch: Partial<NewBookingDraft>): void => {
    setDraft((previous) => ({ ...previous, ...patch }));
  }, []);

  const loadRoomStep = useCallback(async (): Promise<void> => {
    const [availability, ratePlans] = await Promise.all([
      api.inventory.availability({
        propertyId: draft.propertyId,
        checkIn: draft.checkIn,
        checkOut: draft.checkOut,
        adults: draft.adults,
        children: draft.children,
        roomCount: draft.roomCount,
      }),
      api.rate.listRatePlans({
        propertyId: draft.propertyId,
        checkIn: draft.checkIn,
        checkOut: draft.checkOut,
      }),
    ]);
    setRooms(availability.data);
    setPlans(ratePlans.data.data);
  }, [api, draft]);

  const loadQuote = useCallback(async (): Promise<void> => {
    const request = quoteRequestOf(draft);
    if (request === null) return;
    setQuote((await api.quotes.quote(request)).data);
  }, [api, draft]);

  const lookupGuest = useCallback(async (): Promise<void> => {
    const found = (await api.guests.list({ q: draft.guest.phone, limit: 1 })).data.data[0];
    setGuest(found ?? null);
    if (found !== undefined) change({ guest: { ...draft.guest, fullName: found.fullName } });
  }, [api, change, draft.guest]);

  const submit = useCallback(async (): Promise<void> => {
    if (quote === null) return;
    const request = bookingRequestOf(draft, quote.quoteId);
    if (request === null) return;
    try {
      setBooking((await api.bookings.create(request)).data);
      setStep('done');
    } catch (caught) {
      setState(
        writeFailureState(caught, {
          attemptedVersion: '—',
          onReload: () => {
            setState({ kind: 'ready' });
          },
          onLookup: () => {
            setState({ kind: 'ready' });
          },
        }),
      );
    }
  }, [api, draft, quote]);

  const advance = useCallback(async (): Promise<void> => {
    const found = stepIssue(step, draft);
    setIssue(found);
    if (found !== null) return;
    setBusy(true);
    setError(null);
    try {
      if (step === 'channel') {
        await loadRoomStep();
        setStep(nextStep(step));
      } else if (step === 'room') {
        setStep(nextStep(step));
      } else if (step === 'guest') {
        await loadQuote();
        setStep(nextStep(step));
      } else if (step === 'confirm') {
        await submit();
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }, [draft, loadQuote, loadRoomStep, step, submit]);

  if (forced !== undefined) {
    return (
      <section data-testid="new-booking-screen" style={{ display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{t('newBooking.title')}</h1>
        <StateSurface state={forced} />
      </section>
    );
  }

  return (
    <section
      data-testid="new-booking-screen"
      style={{ display: 'grid', gap: 12, padding: '16px 0' }}
    >
      <h1 style={{ margin: 0 }}>{t('newBooking.title')}</h1>
      <p style={{ margin: 0 }} data-testid="new-booking-step">
        {t('newBooking.stepCounter', {
          current: ['channel', 'room', 'guest', 'confirm', 'done'].indexOf(step) + 1,
        })}
      </p>
      <StateSurface state={state}>
        {error === null ? null : (
          <ScreenAlert
            error={error}
            onRetry={() => {
              setError(null);
              setStep('channel');
            }}
          />
        )}
        <StepBody
          step={step}
          draft={draft}
          channels={channels}
          rooms={rooms}
          plans={plans}
          quote={quote}
          guest={guest}
          booking={booking}
          onChange={change}
          onLookup={() => void lookupGuest()}
          onPrint={() => window.print()}
        />
        {issue === null ? null : (
          <p role="alert" data-testid="new-booking-issue" style={{ margin: 0 }}>
            {t(ISSUE_KEYS[issue])}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="new-booking-back"
            disabled={step === 'channel' || step === 'done' || busy}
            onClick={() => {
              setIssue(null);
              setStep(previousStep(step));
            }}
          >
            {t('newBooking.back')}
          </button>
          {step === 'done' ? null : (
            <button
              type="button"
              data-testid="new-booking-next"
              disabled={busy}
              onClick={() => void advance()}
            >
              {t(step === 'confirm' ? 'newBooking.create' : 'newBooking.next')}
            </button>
          )}
        </div>
      </StateSurface>
    </section>
  );
}
