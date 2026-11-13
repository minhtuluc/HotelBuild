'use client';
import type { CSSProperties, ReactElement } from 'react';
import { color, radius, space } from '@pinehill/ui-web';
import type { RoomTypeSummary } from '@pinehill/contracts';
import {
  WALK_IN_STEPS,
  walkInStepNumber,
  type ActionFailure,
  type GuestIssue,
  type StayIssue,
  type WalkInGuest,
  type WalkInStay,
  type WalkInStep,
} from './front-desk-model';
import { FailureNotice } from './desk-tables';
import { deskText } from './messages';

const FIELD: CSSProperties = {
  display: 'grid',
  gap: 4,
  maxWidth: 560,
  fontSize: 13,
  fontWeight: 500,
};

const RATE_PLAN_CODES = ['FLEX7', 'SAVER3', 'NONREF', 'LONGSTAY14'] as const;

const RATE_PLAN_KEYS = {
  FLEX7: 'ratePlanFLEX7',
  SAVER3: 'ratePlanSAVER3',
  NONREF: 'ratePlanNONREF',
  LONGSTAY14: 'ratePlanLONGSTAY14',
} as const;

const STEP_KEYS = {
  stay: 'stepStay',
  guest: 'stepGuest',
  review: 'stepReview',
  deposit: 'stepDeposit',
  done: 'stepDone',
} as const;

export function StepIndicator({ step }: { step: WalkInStep }): ReactElement {
  return (
    <div style={{ display: 'grid', gap: space.s2 }}>
      <ol
        aria-label={deskText('walkInTitle')}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: space.s2,
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {WALK_IN_STEPS.map((item) => {
          const active = item === step;
          return (
            <li
              key={item}
              aria-current={active ? 'step' : undefined}
              data-testid={`walk-in-step-${item}`}
              style={{
                padding: `4px ${space.s3}px`,
                borderRadius: radius.sm,
                border: `1px solid ${active ? color.primary : color.border}`,
                background: active ? '#E7F3EE' : color.bg,
                color: active ? color.primary : color.textMuted,
                fontSize: 13,
                fontWeight: active ? 600 : 400,
              }}
            >
              {walkInStepNumber(item)}. {deskText(STEP_KEYS[item])}
            </li>
          );
        })}
      </ol>
      <p
        style={{ margin: 0, fontSize: 13, color: color.textMuted }}
        data-testid="walk-in-step-label"
      >
        {deskText('walkInStep', {
          current: walkInStepNumber(step),
          total: WALK_IN_STEPS.length,
          name: deskText(STEP_KEYS[step]),
        })}
      </p>
    </div>
  );
}

export function StayStep({
  stay,
  set,
  roomTypes,
  propertyName,
  problem,
}: {
  stay: WalkInStay;
  set: <K extends keyof WalkInStay>(key: K, value: WalkInStay[K]) => void;
  roomTypes: readonly RoomTypeSummary[];
  propertyName: string;
  problem: StayIssue | null;
}): ReactElement {
  return (
    <div style={{ display: 'grid', gap: space.s3 }}>
      <p style={{ margin: 0, fontSize: 14, color: color.textMuted }}>
        {deskText('property')}: <strong style={{ color: color.text }}>{propertyName}</strong>
      </p>
      <label style={FIELD}>
        {deskText('roomType')}
        <select
          name="roomTypeId"
          value={stay.roomTypeId}
          onChange={(event) => {
            set('roomTypeId', event.target.value);
          }}
        >
          <option value="">—</option>
          {roomTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.code}
            </option>
          ))}
        </select>
      </label>
      {roomTypes.length === 0 ? (
        <p style={{ margin: 0, color: color.warning, fontSize: 14 }}>{deskText('walkInEmpty')}</p>
      ) : null}
      <label style={FIELD}>
        {deskText('ratePlan')}
        <select
          name="ratePlanCode"
          value={stay.ratePlanCode}
          onChange={(event) => {
            const next = RATE_PLAN_CODES.find((code) => code === event.target.value);
            if (next !== undefined) set('ratePlanCode', next);
          }}
        >
          {RATE_PLAN_CODES.map((code) => (
            <option key={code} value={code}>
              {deskText(RATE_PLAN_KEYS[code])}
            </option>
          ))}
        </select>
      </label>
      <label style={FIELD}>
        {deskText('checkInDate')}
        <input
          type="date"
          name="walkInCheckIn"
          value={stay.checkIn}
          onChange={(event) => {
            set('checkIn', event.target.value);
          }}
        />
      </label>
      <label style={FIELD}>
        {deskText('checkOutDate')}
        <input
          type="date"
          name="walkInCheckOut"
          value={stay.checkOut}
          onChange={(event) => {
            set('checkOut', event.target.value);
          }}
        />
      </label>
      <label style={FIELD}>
        {deskText('adults')}
        <input
          type="number"
          name="adults"
          min={1}
          max={20}
          value={stay.adults}
          onChange={(event) => {
            set('adults', event.target.value);
          }}
        />
      </label>
      <label style={FIELD}>
        {deskText('children')}
        <input
          type="number"
          name="children"
          min={0}
          max={20}
          value={stay.children}
          onChange={(event) => {
            set('children', event.target.value);
          }}
        />
      </label>
      <label style={FIELD}>
        {deskText('roomCount')}
        <input
          type="number"
          name="roomCount"
          min={1}
          max={10}
          value={stay.roomCount}
          onChange={(event) => {
            set('roomCount', event.target.value);
          }}
        />
      </label>
      {problem === null ? null : (
        <p
          role="alert"
          data-testid="stay-issue"
          style={{ margin: 0, color: color.danger, fontSize: 13 }}
        >
          {deskText(
            problem === 'DATES'
              ? 'invalidDates'
              : problem === 'COUNTS'
                ? 'invalidCount'
                : 'required',
          )}
        </p>
      )}
    </div>
  );
}

export function GuestStep({
  guest,
  onChange,
  note,
  onNote,
  problem,
}: {
  guest: WalkInGuest;
  onChange: (next: WalkInGuest) => void;
  note: string;
  onNote: (value: string) => void;
  problem: GuestIssue | null;
}): ReactElement {
  return (
    <div style={{ display: 'grid', gap: space.s3 }}>
      <label style={FIELD}>
        {deskText('fullName')}
        <input
          name="fullName"
          maxLength={120}
          value={guest.fullName}
          onChange={(event) => {
            onChange({ ...guest, fullName: event.target.value });
          }}
        />
      </label>
      <label style={FIELD}>
        {deskText('phone')}
        <input
          name="phone"
          inputMode="tel"
          maxLength={12}
          value={guest.phone}
          onChange={(event) => {
            onChange({ ...guest, phone: event.target.value });
          }}
        />
      </label>
      <label style={FIELD}>
        {deskText('note')}
        <input
          name="walkInNote"
          maxLength={500}
          value={note}
          onChange={(event) => {
            onNote(event.target.value);
          }}
        />
      </label>
      {problem === null ? null : (
        <p
          role="alert"
          data-testid="guest-issue"
          style={{ margin: 0, color: color.danger, fontSize: 13 }}
        >
          {deskText(problem === 'NAME' ? 'required' : 'invalidPhone')}
        </p>
      )}
    </div>
  );
}

export function ReviewStep({
  propertyName,
  stay,
  roomTypes,
  guest,
  failure,
  creating,
  onCreate,
  onInspect,
}: {
  propertyName: string;
  stay: WalkInStay;
  roomTypes: readonly RoomTypeSummary[];
  guest: WalkInGuest;
  failure: ActionFailure | null;
  creating: boolean;
  onCreate: () => void;
  onInspect: () => void;
}): ReactElement {
  return (
    <div style={{ display: 'grid', gap: space.s3 }}>
      <ul className="ph-list-lines" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <li>
          <span data-testid="walk-in-review">
            {deskText('reviewSummary', {
              property: propertyName,
              roomType:
                roomTypes.find((type) => type.id === stay.roomTypeId)?.code ?? stay.roomTypeId,
              ratePlan: stay.ratePlanCode,
              checkIn: stay.checkIn,
              checkOut: stay.checkOut,
            })}
          </span>
        </li>
        <li>
          <span>
            {deskText('reviewGuests', {
              adults: stay.adults,
              children: stay.children,
              rooms: stay.roomCount,
            })}
          </span>
        </li>
        <li>
          <span>
            {deskText('fullName')}: {guest.fullName} · {deskText('phone')}: {guest.phone}
          </span>
        </li>
      </ul>
      {failure === null ? null : <FailureNotice failure={failure} onInspect={onInspect} />}
      <button
        type="button"
        className="ph-btn-primary"
        style={{ justifySelf: 'start' }}
        disabled={creating}
        onClick={onCreate}
      >
        {deskText('createWalkIn')}
      </button>
    </div>
  );
}

export function WalkInNav({
  step,
  creating,
  onBack,
  onNext,
  onClose,
}: {
  step: WalkInStep;
  creating: boolean;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: space.s2,
        paddingTop: space.s2,
        borderTop: `1px solid ${color.border}`,
      }}
    >
      {step === 'guest' || step === 'review' ? (
        <button type="button" className="ph-btn" disabled={creating} onClick={onBack}>
          {deskText('back')}
        </button>
      ) : null}
      {step === 'stay' || step === 'guest' ? (
        <button type="button" className="ph-btn-primary" onClick={onNext}>
          {deskText('next')}
        </button>
      ) : null}
      <button type="button" className="ph-btn" onClick={onClose}>
        {deskText('panelClose')}
      </button>
    </div>
  );
}
