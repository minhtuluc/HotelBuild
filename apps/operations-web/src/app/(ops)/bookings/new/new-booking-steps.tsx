'use client';

/** Các bước của SCR-33/SCR-34 (HB-107): tách khỏi luồng dữ liệu để mỗi file gọn và dễ kiểm. */
import type { ReactElement } from 'react';
import { formatDateTimeVn, formatMoney } from '@pinehill/ui-web';
import type {
  Availability,
  BookingSummary,
  ChannelSummary,
  GuestSummary,
  Quote,
  RatePlanPublic,
} from '@pinehill/contracts';
import { t } from '../../../../lib/i18n';
import { COUNTER_CHANNELS, depositOf, planCodeOf, type NewBookingDraft } from './new-booking-model';

const FIELD = { display: 'grid', gap: 4 } as const;

function Field({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <label style={FIELD}>
      {label}
      {children}
    </label>
  );
}

export function ChannelStep({
  draft,
  channels,
  onChange,
}: {
  draft: NewBookingDraft;
  channels: readonly ChannelSummary[];
  onChange: (patch: Partial<NewBookingDraft>) => void;
}): ReactElement {
  return (
    <fieldset data-testid="step-channel" style={{ display: 'grid', gap: 8 }}>
      <legend>{t('newBooking.step.channel')}</legend>
      <Field label={t('newBooking.channel')}>
        <select
          name="channel"
          value={draft.channel}
          onChange={(event) => {
            onChange({ channel: event.target.value === 'PHONE' ? 'PHONE' : 'WALKIN' });
          }}
        >
          {COUNTER_CHANNELS.map((code) => (
            <option key={code} value={code}>
              {t(code === 'WALKIN' ? 'newBooking.channel.WALKIN' : 'newBooking.channel.PHONE')}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('newBooking.propertyId')}>
        <input
          name="propertyId"
          value={draft.propertyId}
          onChange={(event) => {
            onChange({ propertyId: event.target.value });
          }}
        />
      </Field>
      <Field label={t('newBooking.checkIn')}>
        <input
          name="checkIn"
          type="date"
          value={draft.checkIn}
          onChange={(event) => {
            onChange({ checkIn: event.target.value });
          }}
        />
      </Field>
      <Field label={t('newBooking.checkOut')}>
        <input
          name="checkOut"
          type="date"
          value={draft.checkOut}
          onChange={(event) => {
            onChange({ checkOut: event.target.value });
          }}
        />
      </Field>
      <Field label={t('newBooking.guests')}>
        <input
          name="adults"
          type="number"
          min={1}
          value={draft.adults}
          onChange={(event) => {
            onChange({ adults: Number(event.target.value) });
          }}
        />
      </Field>
      <Field label={t('newBooking.roomCount')}>
        <input
          name="roomCount"
          type="number"
          min={1}
          value={draft.roomCount}
          onChange={(event) => {
            onChange({ roomCount: Number(event.target.value) });
          }}
        />
      </Field>
      <p style={{ margin: 0 }} data-testid="step-channel-hold">
        {t(draft.channel === 'PHONE' ? 'newBooking.hold.phone' : 'newBooking.hold.walkin', {
          minutes: channels.find((channel) => channel.code === draft.channel)?.holdMinutes ?? '—',
        })}
      </p>
    </fieldset>
  );
}

export function RoomStep({
  draft,
  rooms,
  plans,
  onChange,
}: {
  draft: NewBookingDraft;
  rooms: Availability | null;
  plans: readonly RatePlanPublic[];
  onChange: (patch: Partial<NewBookingDraft>) => void;
}): ReactElement {
  return (
    <fieldset data-testid="step-room" style={{ display: 'grid', gap: 8 }}>
      <legend>{t('newBooking.step.room')}</legend>
      <Field label={t('newBooking.roomType')}>
        <select
          name="roomTypeId"
          value={draft.roomTypeId}
          onChange={(event) => {
            onChange({ roomTypeId: event.target.value });
          }}
        >
          <option value="">{t('newBooking.pick')}</option>
          {(rooms?.data ?? []).map((room) => (
            <option key={room.roomTypeId} value={room.roomTypeId}>
              {room.roomTypeName} ·{' '}
              {room.soldOut
                ? t('newBooking.soldOut')
                : t('newBooking.available', { count: room.availableCount })}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('newBooking.ratePlan')}>
        <select
          name="ratePlanCode"
          value={draft.ratePlanCode}
          onChange={(event) => {
            onChange({ ratePlanCode: planCodeOf(event.target.value) ?? '' });
          }}
        >
          <option value="">{t('newBooking.pick')}</option>
          {plans.map((plan) => (
            <option key={plan.code} value={plan.code}>
              {plan.name} · {t('newBooking.depositPercent', { percent: plan.depositPercent })}
            </option>
          ))}
        </select>
      </Field>
    </fieldset>
  );
}

export function GuestStep({
  draft,
  found,
  onChange,
  onLookup,
}: {
  draft: NewBookingDraft;
  found: GuestSummary | null;
  onChange: (patch: Partial<NewBookingDraft>) => void;
  onLookup: () => void;
}): ReactElement {
  return (
    <fieldset data-testid="step-guest" style={{ display: 'grid', gap: 8 }}>
      <legend>{t('newBooking.step.guest')}</legend>
      <Field label={t('newBooking.guest.phone')}>
        <input
          name="guestPhone"
          value={draft.guest.phone}
          onChange={(event) => {
            onChange({ guest: { ...draft.guest, phone: event.target.value } });
          }}
        />
      </Field>
      {draft.channel !== 'PHONE' ? null : (
        <button type="button" data-testid="guest-lookup" onClick={onLookup}>
          {t('newBooking.guest.lookup')}
        </button>
      )}
      {found === null ? null : (
        <p style={{ margin: 0 }} data-testid="guest-found">
          {t('newBooking.guest.found', { name: found.fullName, tier: found.loyaltyTier })}
        </p>
      )}
      <Field label={t('newBooking.guest.fullName')}>
        <input
          name="guestFullName"
          value={draft.guest.fullName}
          onChange={(event) => {
            onChange({ guest: { ...draft.guest, fullName: event.target.value } });
          }}
        />
      </Field>
    </fieldset>
  );
}

export function ConfirmStep({
  draft,
  quote,
  holdMinutes,
}: {
  draft: NewBookingDraft;
  quote: Quote | null;
  holdMinutes: number | null;
}): ReactElement {
  return (
    <fieldset data-testid="step-confirm" style={{ display: 'grid', gap: 8 }}>
      <legend>{t('newBooking.step.confirm')}</legend>
      <p style={{ margin: 0 }}>
        {t('newBooking.summary.stay', { from: draft.checkIn, to: draft.checkOut })}
      </p>
      <p style={{ margin: 0 }}>
        {t('newBooking.summary.channel', {
          channel: t(
            draft.channel === 'PHONE' ? 'newBooking.channel.PHONE' : 'newBooking.channel.WALKIN',
          ),
        })}
      </p>
      {quote === null ? (
        <p role="status" style={{ margin: 0 }}>
          {t('newBooking.quote.loading')}
        </p>
      ) : (
        <p style={{ margin: 0 }} data-testid="confirm-quote">
          {t('newBooking.summary.quote', {
            total: formatMoney(quote.total),
            deposit: formatMoney(depositOf(quote).amount),
            percent: depositOf(quote).percent,
          })}
        </p>
      )}
      {holdMinutes === null ? null : (
        <p style={{ margin: 0 }} data-testid="confirm-hold">
          {t('newBooking.summary.hold', { minutes: holdMinutes })}
        </p>
      )}
      <p style={{ margin: 0 }}>{t('newBooking.collectNote')}</p>
    </fieldset>
  );
}

export function DoneStep({
  booking,
  onPrint,
}: {
  booking: BookingSummary;
  onPrint: () => void;
}): ReactElement {
  return (
    <section data-testid="step-done" style={{ display: 'grid', gap: 8 }}>
      <h2 style={{ margin: 0 }}>{t('newBooking.done.title')}</h2>
      <p style={{ margin: 0 }} data-testid="done-code">
        {t('newBooking.done.code', { code: booking.code })}
      </p>
      <p style={{ margin: 0 }}>{t('newBooking.done.status', { status: booking.status })}</p>
      {booking.holdExpiresAt === null ? null : (
        <p style={{ margin: 0 }} data-testid="done-hold">
          {t('newBooking.done.hold', { time: formatDateTimeVn(booking.holdExpiresAt) })}
        </p>
      )}
      <p style={{ margin: 0 }}>{t('newBooking.done.collect')}</p>
      <p style={{ margin: 0 }}>{t('newBooking.done.notify')}</p>
      <button type="button" data-testid="done-print" onClick={onPrint}>
        {t('newBooking.done.print')}
      </button>
    </section>
  );
}
