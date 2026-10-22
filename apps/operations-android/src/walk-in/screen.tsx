/**
 * SCR-65 — tạo booking walk-in (UC-BOOK-02), tối đa 5 bước. Logic ở `WalkInFlow`; màn hình chỉ hiển thị trạng
 * thái và gửi ý định. Giá, tồn, cọc và nghi trùng do máy chủ quyết (ADR-018); chỉ chạy khi có mạng.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { color, space, typography } from '@pinehill/ui-native';
import { todayVN } from '../housekeeping/reader';
import { formatVnd } from '../lookup/view';
import type { Session } from '../session';
import { ActionButton } from './controls';
import { DepositStep } from './deposit';
import type { WalkInFlow, WalkInState } from './flow';
import { walkInText as text } from './messages';
import { FailureNotice, GuestStep, ReviewStep, StayStep, StepHeader } from './steps';

export interface WalkInScreenProps {
  session: Session;
  createFlow: () => WalkInFlow;
  onBack: () => void;
}

function Done({ state, onAnother }: { state: WalkInState; onAnother: () => void }): ReactElement {
  const code = state.result?.booking.code ?? '';
  const paid = state.payment;
  return (
    <View testID="walk-in-done" accessibilityLiveRegion="polite" style={{ gap: space.s2 }}>
      <Text style={{ color: color.success, fontWeight: '700' }}>
        {paid === null ? text('doneWithoutDeposit', { code }) : text('doneWithDeposit', { code })}
      </Text>
      {paid === null ? null : (
        <Text>
          {text('paymentReference', {
            id: paid.paymentId,
            amount: formatVnd(paid.amount),
            method: paid.method,
          })}
        </Text>
      )}
      <ActionButton
        testID="walk-in-another"
        label={text('another')}
        tone="plain"
        onPress={onAnother}
      />
    </View>
  );
}

function Body({ flow, state }: { flow: WalkInFlow; state: WalkInState }): ReactElement | null {
  switch (state.step) {
    case 'stay':
      return (
        <StayStep
          stay={state.stay}
          types={state.types}
          roomTypes={state.roomTypes}
          problem={state.stayProblem}
          set={(patch) => {
            flow.setStay(patch);
          }}
          onRetry={() => void flow.init(state.stay.propertyId, state.stay.checkIn)}
        />
      );
    case 'guest':
      return (
        <GuestStep
          guest={state.guest}
          note={state.note}
          problem={state.guestProblem}
          onGuest={(patch) => {
            flow.setGuest(patch);
          }}
          onNote={(note) => {
            flow.setNote(note);
          }}
        />
      );
    case 'review':
      return (
        <ReviewStep
          stay={state.stay}
          guest={state.guest}
          roomType={state.roomTypes.find((item) => item.id === state.stay.roomTypeId)}
        />
      );
    case 'deposit':
      return <DepositStep flow={flow} state={state} />;
    case 'done':
      return null;
  }
}

function Footer({
  flow,
  state,
  onBack,
}: {
  flow: WalkInFlow;
  state: WalkInState;
  onBack: () => void;
}): ReactElement {
  const busy = state.busy !== null;
  const review = state.step === 'review';
  const editing = state.step === 'stay' || state.step === 'guest' || review;
  return (
    <View style={{ padding: space.s4, gap: space.s2 }}>
      {editing ? (
        <ActionButton
          testID={review ? 'walk-in-create' : 'walk-in-next'}
          label={review ? text(busy ? 'creating' : 'create') : text('next')}
          disabled={busy}
          onPress={() => {
            if (review) void flow.create();
            else flow.next();
          }}
        />
      ) : null}
      {state.step === 'guest' || review ? (
        <ActionButton
          testID="walk-in-back-step"
          label={text('back')}
          tone="plain"
          disabled={busy}
          onPress={() => {
            flow.back();
          }}
        />
      ) : null}
      <ActionButton testID="walk-in-home" label={text('home')} tone="plain" onPress={onBack} />
    </View>
  );
}

export function WalkInScreen({ session, createFlow, onBack }: WalkInScreenProps): ReactElement {
  const [flow, setFlow] = useState<WalkInFlow | null>(null);
  const [state, setState] = useState<WalkInState | null>(null);
  const property = session.selectedProperty();
  useEffect(() => {
    const active = createFlow();
    setFlow(active);
    setState(active.state);
    const unsubscribe = active.subscribe(() => {
      setState(active.state);
    });
    // Đổi phiên/cơ sở: bỏ luồng đang dở (khoá idempotency, pinToken) rồi bắt đầu lại.
    const sessionChanges = session.subscribe(() => {
      const next = session.selectedProperty();
      if (next !== null) void active.init(next, todayVN(new Date()));
    });
    const first = session.selectedProperty();
    if (first !== null) void active.init(first, todayVN(new Date()));
    return () => {
      unsubscribe();
      sessionChanges();
      active.dispose();
    };
  }, [session, createFlow]);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: space.s4, gap: space.s3 }}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}
        >
          {text('title')}
        </Text>
        {property === null ? <Text testID="walk-in-no-property">{text('noProperty')}</Text> : null}
        {flow === null || state === null || property === null ? null : (
          <>
            <StepHeader step={state.step} />
            <Body flow={flow} state={state} />
            {state.step === 'done' ? (
              <Done state={state} onAnother={() => void flow.init(property, todayVN(new Date()))} />
            ) : null}
            {state.failure === null ? null : <FailureNotice failure={state.failure} />}
          </>
        )}
      </ScrollView>
      {flow === null || state === null || property === null ? (
        <View style={{ padding: space.s4 }}>
          <ActionButton testID="walk-in-home" label={text('home')} tone="plain" onPress={onBack} />
        </View>
      ) : (
        <Footer flow={flow} state={state} onBack={onBack} />
      )}
    </View>
  );
}
