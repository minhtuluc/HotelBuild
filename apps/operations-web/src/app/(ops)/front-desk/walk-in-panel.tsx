'use client';
import { useRef, useState, type ReactElement } from 'react';
import { color, radius, space, typography } from '@pinehill/ui-web';
import type { RoomTypeSummary, WalkInResult } from '@pinehill/contracts';
import type { DeskApi, DeskProperty } from './front-desk-api';
import {
  actionFailure,
  guestIssue,
  nextWalkInStep,
  previousWalkInStep,
  stayIssue,
  stepChecks,
  toWalkInRequest,
  walkInDefaults,
  type ActionFailure,
  type GuestIssue,
  type StayIssue,
  type WalkInGuest,
  type WalkInStay,
  type WalkInStep,
} from './front-desk-model';
import { GuestStep, ReviewStep, StayStep, StepIndicator, WalkInNav } from './walk-in-steps';
import { WalkInDeposit } from './walk-in-deposit';
import { deskText } from './messages';

/**
 * Walk-in ≤ 5 bước (AC3): kỳ lưu trú → khách → xác nhận/tạo (`POST /walk-in`, một lệnh điều phối) →
 * thu cọc (`POST /payments`) → hoàn tất. Không tự tính giá/tồn; mọi số tiền lấy từ kết quả máy chủ.
 */
export function WalkInPanel({
  api,
  pinToken,
  date,
  propertyId,
  properties,
  roomTypes,
  onClose,
  onDone,
  onInspect,
}: {
  api: DeskApi;
  pinToken: { current: string | null };
  date: string;
  propertyId: string;
  properties: readonly DeskProperty[];
  roomTypes: readonly RoomTypeSummary[];
  onClose: () => void;
  onDone: () => void;
  onInspect: () => void;
}): ReactElement {
  const [step, setStep] = useState<WalkInStep>('stay');
  const [stay, setStay] = useState<WalkInStay>(() => walkInDefaults(propertyId, date));
  const [guest, setGuest] = useState<WalkInGuest>({ fullName: '', phone: '' });
  const [note, setNote] = useState('');
  const [stayProblem, setStayProblem] = useState<StayIssue | null>(null);
  const [guestProblem, setGuestProblem] = useState<GuestIssue | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<WalkInResult | null>(null);
  const [creating, setCreating] = useState(false);
  const createKey = useRef<string | null>(null);
  const propertyName = properties.find((item) => item.id === propertyId)?.name ?? propertyId;
  const showDeposit = result !== null && (step === 'deposit' || step === 'done');

  const set = <K extends keyof WalkInStay>(key: K, value: WalkInStay[K]): void => {
    setStay((previous) => ({ ...previous, [key]: value }));
    setStayProblem(null);
  };

  const advance = (): void => {
    const checks = stepChecks(step, stay, guest);
    setStayProblem(checks.stay);
    setGuestProblem(checks.guest);
    if (checks.stay === null && checks.guest === null) setStep(nextWalkInStep(step));
  };

  const create = async (): Promise<void> => {
    if (creating || stayIssue(stay) !== null || guestIssue(guest) !== null) return;
    setCreating(true);
    setFailure(null);
    // Chỉ giữ key khi kết quả chưa xác định; lần bị từ chối rõ ràng được phép dùng key mới.
    if (failure?.kind !== 'unknownOutcome') createKey.current = globalThis.crypto.randomUUID();
    try {
      const response = await api.walkIn(
        toWalkInRequest(stay, guest, note),
        createKey.current ?? undefined,
      );
      setResult(response.data);
      setStep('deposit');
      onDone();
    } catch (caught) {
      setFailure(actionFailure(caught));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section
      aria-labelledby="desk-walk-in-title"
      data-testid="walk-in-panel"
      style={{
        border: `1px solid ${color.borderStrong}`,
        borderRadius: radius.md,
        padding: space.s4,
        display: 'grid',
        gap: space.s3,
      }}
    >
      <h2 id="desk-walk-in-title" style={{ margin: 0, fontSize: typography.h2.web }}>
        {deskText('walkInTitle')}
      </h2>
      <StepIndicator step={step} />
      {step === 'stay' ? (
        <StayStep
          stay={stay}
          set={set}
          roomTypes={roomTypes}
          propertyName={propertyName}
          problem={stayProblem}
        />
      ) : null}
      {step === 'guest' ? (
        <GuestStep
          guest={guest}
          onChange={(next) => {
            setGuest(next);
            setGuestProblem(null);
          }}
          note={note}
          onNote={setNote}
          problem={guestProblem}
        />
      ) : null}
      {step === 'review' ? (
        <ReviewStep
          propertyName={propertyName}
          stay={stay}
          roomTypes={roomTypes}
          guest={guest}
          failure={failure}
          creating={creating}
          onCreate={() => {
            void create();
          }}
          onInspect={onInspect}
        />
      ) : null}
      {showDeposit && result !== null ? (
        <WalkInDeposit
          result={result}
          api={api}
          pinToken={pinToken}
          onInspect={onInspect}
          onDone={onDone}
          onPaid={() => {
            setStep('done');
          }}
        />
      ) : null}
      <WalkInNav
        step={step}
        creating={creating}
        onBack={() => {
          setFailure(null);
          setStep(previousWalkInStep(step));
        }}
        onNext={advance}
        onClose={onClose}
      />
    </section>
  );
}
