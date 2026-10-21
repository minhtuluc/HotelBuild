'use client';
import type { ReactElement } from 'react';
import { space } from '@pinehill/ui-web';
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
import { CONTROL, FailureNotice } from './desk-tables';
import { deskText } from './messages';

const FIELD = { display: 'grid', gap: 4, maxWidth: 560 } as const;

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
    <>
      <ol
        aria-label={deskText('walkInTitle')}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {WALK_IN_STEPS.map((item) => (
          <li
            key={item}
            aria-current={item === step ? 'step' : undefined}
            data-testid={`walk-in-step-${item}`}
            style={{ fontWeight: item === step ? 700 : 400 }}
          >
            {walkInStepNumber(item)}. {deskText(STEP_KEYS[item])}
          </li>
        ))}
      </ol>
      <p style={{ margin: 0 }} data-testid="walk-in-step-label">
        {deskText('walkInStep', {
          current: walkInStepNumber(step),
          total: WALK_IN_STEPS.length,
          name: deskText(STEP_KEYS[step]),
        })}
      </p>
    </>
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
      <p style={{ margin: 0 }}>
        {deskText('property')}: {propertyName}
      </p>
      <label style={FIELD}>
        {deskText('roomType')}
        <select
          style={CONTROL}
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
      {roomTypes.length === 0 ? <p style={{ margin: 0 }}>{deskText('walkInEmpty')}</p> : null}
      <label style={FIELD}>
        {deskText('ratePlan')}
        <select
          style={CONTROL}
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
          style={CONTROL}
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
          style={CONTROL}
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
          style={CONTROL}
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
          style={CONTROL}
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
          style={CONTROL}
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
        <p role="alert" data-testid="stay-issue" style={{ margin: 0 }}>
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
          style={CONTROL}
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
          style={CONTROL}
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
          style={CONTROL}
          name="walkInNote"
          maxLength={500}
          value={note}
          onChange={(event) => {
            onNote(event.target.value);
          }}
        />
      </label>
      {problem === null ? null : (
        <p role="alert" data-testid="guest-issue" style={{ margin: 0 }}>
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
      <p style={{ margin: 0 }} data-testid="walk-in-review">
        {deskText('reviewSummary', {
          property: propertyName,
          roomType: roomTypes.find((type) => type.id === stay.roomTypeId)?.code ?? stay.roomTypeId,
          ratePlan: stay.ratePlanCode,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
        })}
      </p>
      <p style={{ margin: 0 }}>
        {deskText('reviewGuests', {
          adults: stay.adults,
          children: stay.children,
          rooms: stay.roomCount,
        })}
      </p>
      <p style={{ margin: 0 }}>
        {deskText('fullName')}: {guest.fullName} · {deskText('phone')}: {guest.phone}
      </p>
      {failure === null ? null : <FailureNotice failure={failure} onInspect={onInspect} />}
      <button type="button" style={CONTROL} disabled={creating} onClick={onCreate}>
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {step === 'guest' || step === 'review' ? (
        <button type="button" style={CONTROL} disabled={creating} onClick={onBack}>
          {deskText('back')}
        </button>
      ) : null}
      {step === 'stay' || step === 'guest' ? (
        <button type="button" style={CONTROL} onClick={onNext}>
          {deskText('next')}
        </button>
      ) : null}
      <button type="button" style={CONTROL} onClick={onClose}>
        {deskText('panelClose')}
      </button>
    </div>
  );
}
