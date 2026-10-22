import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import type { RoomTypeSummary } from '@pinehill/contracts';
import { color, space } from '@pinehill/ui-native';
import { ActionButton, Choice, Field } from './controls';
import { walkInText as text } from './messages';
import {
  RATE_PLAN_CODES,
  WALK_IN_STEPS,
  stepNumber,
  type GuestIssue,
  type RatePlanCode,
  type StayIssue,
  type WalkInGuest,
  type WalkInStay,
  type WalkInStep,
} from './model';
import type { FlowFailure, TypesPhase } from './flow';

const STEP_KEYS = {
  stay: 'stepStay',
  guest: 'stepGuest',
  review: 'stepReview',
  deposit: 'stepDeposit',
  done: 'stepDone',
} as const;

const RATE_KEYS = {
  FLEX7: 'ratePlanFLEX7',
  SAVER3: 'ratePlanSAVER3',
  NONREF: 'ratePlanNONREF',
  LONGSTAY14: 'ratePlanLONGSTAY14',
} as const;

const STAY_ISSUES = {
  PROPERTY: 'issueProperty',
  ROOM_TYPE: 'issueRoomType',
  DATES: 'issueDates',
  COUNTS: 'issueCounts',
} as const;

const GUEST_ISSUES = { NAME: 'issueName', PHONE: 'issuePhone' } as const;

export function ratePlanName(code: RatePlanCode): string {
  return text(RATE_KEYS[code]);
}

export function StepHeader({ step }: { step: WalkInStep }): ReactElement {
  return (
    <Text
      testID="walk-in-step"
      accessibilityLiveRegion="polite"
      style={{ color: color.textMuted, fontWeight: '700' }}
    >
      {text('step', {
        current: stepNumber(step),
        total: WALK_IN_STEPS.length,
        name: text(STEP_KEYS[step]),
      })}
    </Text>
  );
}

export function Problem({
  id,
  message,
}: {
  id: string;
  message: string | null;
}): ReactElement | null {
  if (message === null) return null;
  return (
    <Text testID={id} accessibilityRole="alert" style={{ color: color.danger }}>
      {message}
    </Text>
  );
}

function RoomTypes({
  types,
  roomTypes,
  selected,
  onSelect,
  onRetry,
}: {
  types: TypesPhase;
  roomTypes: readonly RoomTypeSummary[];
  selected: string;
  onSelect: (id: string) => void;
  onRetry: () => void;
}): ReactElement {
  if (types === 'loading') return <Text testID="walk-in-types">{text('typesLoading')}</Text>;
  if (types !== 'ready')
    return (
      <View style={{ gap: space.s2 }}>
        <Text testID="walk-in-types" accessibilityLiveRegion="polite">
          {text(types === 'offline' ? 'typesOffline' : 'typesError')}
        </Text>
        <ActionButton
          testID="walk-in-types-retry"
          label={text('retry')}
          tone="plain"
          onPress={onRetry}
        />
      </View>
    );
  if (roomTypes.length === 0) return <Text testID="walk-in-types">{text('typesEmpty')}</Text>;
  return (
    <View style={{ gap: space.s2 }}>
      {roomTypes.map((type) => (
        <Choice
          key={type.id}
          testID={'walk-in-room-type-' + type.id}
          label={text('roomTypeOption', { code: type.code })}
          selected={selected === type.id}
          onSelect={() => {
            onSelect(type.id);
          }}
        />
      ))}
    </View>
  );
}

export function StayStep({
  stay,
  types,
  roomTypes,
  problem,
  set,
  onRetry,
}: {
  stay: WalkInStay;
  types: TypesPhase;
  roomTypes: readonly RoomTypeSummary[];
  problem: StayIssue | null;
  set: (patch: Partial<WalkInStay>) => void;
  onRetry: () => void;
}): ReactElement {
  return (
    <View style={{ gap: space.s2 }}>
      <Text style={{ fontWeight: '700' }}>{text('roomType')}</Text>
      <RoomTypes
        types={types}
        roomTypes={roomTypes}
        selected={stay.roomTypeId}
        onSelect={(roomTypeId) => {
          set({ roomTypeId });
        }}
        onRetry={onRetry}
      />
      <Text style={{ fontWeight: '700' }}>{text('ratePlan')}</Text>
      {RATE_PLAN_CODES.map((code) => (
        <Choice
          key={code}
          testID={'walk-in-rate-' + code}
          label={text('ratePlanOption', { name: ratePlanName(code) })}
          selected={stay.ratePlanCode === code}
          onSelect={() => {
            set({ ratePlanCode: code });
          }}
        />
      ))}
      <Field
        testID="walk-in-check-in"
        label={text('checkIn')}
        value={stay.checkIn}
        maxLength={10}
        onChange={(checkIn) => {
          set({ checkIn });
        }}
      />
      <Field
        testID="walk-in-check-out"
        label={text('checkOut')}
        value={stay.checkOut}
        maxLength={10}
        onChange={(checkOut) => {
          set({ checkOut });
        }}
      />
      <Field
        testID="walk-in-adults"
        label={text('adults')}
        value={stay.adults}
        keyboard="number-pad"
        maxLength={2}
        onChange={(adults) => {
          set({ adults });
        }}
      />
      <Field
        testID="walk-in-children"
        label={text('children')}
        value={stay.children}
        keyboard="number-pad"
        maxLength={2}
        onChange={(children) => {
          set({ children });
        }}
      />
      <Field
        testID="walk-in-room-count"
        label={text('roomCount')}
        value={stay.roomCount}
        keyboard="number-pad"
        maxLength={2}
        onChange={(roomCount) => {
          set({ roomCount });
        }}
      />
      <Problem
        id="walk-in-stay-issue"
        message={problem === null ? null : text(STAY_ISSUES[problem])}
      />
    </View>
  );
}

export function GuestStep({
  guest,
  note,
  problem,
  onGuest,
  onNote,
}: {
  guest: WalkInGuest;
  note: string;
  problem: GuestIssue | null;
  onGuest: (patch: Partial<WalkInGuest>) => void;
  onNote: (note: string) => void;
}): ReactElement {
  return (
    <View style={{ gap: space.s2 }}>
      <Field
        testID="walk-in-name"
        label={text('fullName')}
        value={guest.fullName}
        maxLength={120}
        onChange={(fullName) => {
          onGuest({ fullName });
        }}
      />
      <Field
        testID="walk-in-phone"
        label={text('phone')}
        value={guest.phone}
        keyboard="phone-pad"
        maxLength={12}
        onChange={(phone) => {
          onGuest({ phone });
        }}
      />
      <Field
        testID="walk-in-note"
        label={text('note')}
        value={note}
        maxLength={500}
        onChange={onNote}
      />
      <Problem
        id="walk-in-guest-issue"
        message={problem === null ? null : text(GUEST_ISSUES[problem])}
      />
    </View>
  );
}

export function ReviewStep({
  stay,
  guest,
  roomType,
}: {
  stay: WalkInStay;
  guest: WalkInGuest;
  roomType: RoomTypeSummary | undefined;
}): ReactElement {
  return (
    <View style={{ gap: space.s2 }} testID="walk-in-review">
      <Text>
        {text('reviewStay', {
          roomType: roomType?.code ?? stay.roomTypeId,
          ratePlan: ratePlanName(stay.ratePlanCode),
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
        })}
      </Text>
      <Text>
        {text('reviewParty', {
          adults: stay.adults,
          children: stay.children,
          rooms: stay.roomCount,
        })}
      </Text>
      <Text>{text('reviewGuest', { name: guest.fullName.trim(), phone: guest.phone.trim() })}</Text>
      <Text style={{ color: color.textMuted }}>{text('reviewNote')}</Text>
    </View>
  );
}

export function FailureNotice({ failure }: { failure: FlowFailure }): ReactElement {
  switch (failure.kind) {
    case 'offline':
      return <Problem id="walk-in-failure" message={text('offline')} />;
    case 'conflict':
      return <Problem id="walk-in-failure" message={text('conflict')} />;
    case 'forbidden':
      return <Problem id="walk-in-failure" message={text('forbidden')} />;
    case 'unknownOutcome':
      return (
        <Problem
          id="walk-in-failure"
          message={text('unknownOutcome', { reference: failure.reference })}
        />
      );
    case 'rejected':
      return (
        <View testID="walk-in-failure" accessibilityRole="alert" style={{ gap: space.s1 }}>
          <Text style={{ color: color.danger, fontWeight: '700' }}>{text('rejected')}</Text>
          <Text>{text('rejectedCode', { code: failure.code })}</Text>
          <Text>{text('rejectedReason', { reason: failure.reason })}</Text>
        </View>
      );
  }
}
