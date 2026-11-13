'use client';

/** Các bước của SCR-33/SCR-34 (HB-107): tách khỏi luồng dữ liệu để mỗi file gọn và dễ kiểm. */
import type { ReactElement } from 'react';
import { formatDateTimeVn, formatMoney, space } from '@pinehill/ui-web';
import type {
  Availability,
  BookingSummary,
  ChannelSummary,
  GuestSummary,
  Quote,
  RatePlanPublic,
} from '@pinehill/contracts';
import {
  OPS_COMPACT_BTN_STYLE,
  OPS_FIELD_LABEL_STYLE,
  OPS_SUBTITLE_STYLE,
  OPS_TABULAR_STYLE,
  opsNoticeStyle,
} from '../../../../components/editorial-styles';
import { t } from '../../../../lib/i18n';
import { COUNTER_CHANNELS, depositOf, planCodeOf, type NewBookingDraft } from './new-booking-model';

function Field({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <label style={OPS_FIELD_LABEL_STYLE}>
      {label}
      {children}
    </label>
  );
}

const STEP_CARD = { display: 'grid', gap: space.s3, padding: space.s4, margin: 0 } as const;

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
    <fieldset data-testid="step-channel" className="ph-card" style={STEP_CARD}>
      <legend style={{ fontWeight: 600, paddingInline: space.s2 }}>
        {t('newBooking.step.channel')}
      </legend>
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
    <fieldset data-testid="step-room" className="ph-card" style={STEP_CARD}>
      <legend style={{ fontWeight: 600, paddingInline: space.s2 }}>
        {t('newBooking.step.room')}
      </legend>
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
    <fieldset data-testid="step-guest" className="ph-card" style={STEP_CARD}>
      <legend style={{ fontWeight: 600, paddingInline: space.s2 }}>
        {t('newBooking.step.guest')}
      </legend>
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
        <div>
          <button
            type="button"
            className="ph-btn"
            style={OPS_COMPACT_BTN_STYLE}
            data-testid="guest-lookup"
            onClick={onLookup}
          >
            {t('newBooking.guest.lookup')}
          </button>
        </div>
      )}
      {found === null ? null : (
        <p style={opsNoticeStyle('info')} data-testid="guest-found">
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
    <fieldset
      data-testid="step-confirm"
      className="ph-card"
      style={{ ...STEP_CARD, ...OPS_TABULAR_STYLE }}
    >
      <legend style={{ fontWeight: 600, paddingInline: space.s2 }}>
        {t('newBooking.step.confirm')}
      </legend>
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
    <section data-testid="step-done" className="ph-card" style={STEP_CARD}>
      <h2 style={OPS_SUBTITLE_STYLE}>{t('newBooking.done.title')}</h2>
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
      <div>
        <button
          type="button"
          className="ph-btn"
          style={OPS_COMPACT_BTN_STYLE}
          data-testid="done-print"
          onClick={onPrint}
        >
          {t('newBooking.done.print')}
        </button>
      </div>
    </section>
  );
}
