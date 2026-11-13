/**
 * SCR-63 — đổi phòng bậc 1–2 (UC-OVER-01/02). Quản lý/chủ chuỗi xem thang + bảng xếp hạng đầy đủ và duyệt;
 * lễ tân chỉ thấy phương án của chính booking, lập điều chuyển và thực hiện bằng PIN. Mọi số liệu và kết
 * quả là của máy chủ; màn hình không tính giá/điểm/hạn và không tự đóng ca.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import type { UserMe } from '@pinehill/contracts';
import { color, space } from '@pinehill/ui-native';
import { ActionButton, CheckRow } from '../../arrivals/controls';
import type { Session } from '../../session';
import { theme } from '../../theme';
import { RelocationFlow, type Command, type FlowState } from './flow';
import { f6Text as text } from './messages';
import {
  canApprove,
  canCreate,
  canExecute,
  canReadCases,
  type Failure,
  type MoveContext,
} from './model';
import { PinForm } from './pin-form';
import { f6Ports } from './ports';
import { Candidates, Ladder, MoveSummary, Options } from './relocation-parts';
import type { RelocationState } from './reader';

export interface RelocationScreenProps {
  session: Session;
  profile: UserMe;
  context: MoveContext;
  moveId: string;
  online: () => Promise<boolean>;
  createId: () => string;
  onBack: () => void;
}

const IDLE_READ: RelocationState = {
  phase: 'idle',
  detail: null,
  options: null,
  move: null,
  syncedAt: null,
  stale: false,
};

function useRelocation(props: RelocationScreenProps) {
  const { session, profile, context, moveId, online, createId } = props;
  const [flow, setFlow] = useState<RelocationFlow | null>(null);
  const [read, setRead] = useState<RelocationState>(IDLE_READ);
  const [state, setState] = useState<FlowState | null>(null);
  useEffect(() => {
    const active = new RelocationFlow(
      f6Ports(session, { online, createId }),
      profile.role,
      context,
    );
    setFlow(active);
    setState(active.state);
    const unsubscribe = active.subscribe(() => {
      setState(active.state);
    });
    const unsubscribeRead = active.reader.subscribe(() => {
      setRead(active.reader.state);
    });
    // Đổi phiên/cơ sở: bỏ PIN, khoá chờ và dữ liệu cũ rồi tải lại; mất token thì không tải.
    const sessionChanges = session.subscribe(() => {
      active.reset();
      if (session.hasAccessToken()) void active.load(moveId);
    });
    void active.load(moveId);
    return () => {
      unsubscribe();
      unsubscribeRead();
      sessionChanges();
      active.dispose();
    };
  }, [
    session,
    profile.role,
    context.caseId,
    context.bookingId,
    context.bookingRoomId,
    moveId,
    online,
    createId,
  ]);
  return { flow, read, state };
}

function failureText(failure: Failure): string {
  switch (failure.kind) {
    case 'unknownOutcome':
      return text('unknownOutcome', { reference: failure.reference });
    case 'inProgress':
      return text('inProgress', { seconds: failure.retryAfterSeconds });
    case 'rejected':
      return text('rejected', { code: failure.code });
    case 'pinLocked':
      return text('pinLocked');
    case 'pinRequired':
      return text('pinWrong');
    case 'forbidden':
      return text('failForbidden');
    default:
      return text(failure.kind);
  }
}

function commandText(command: Command): string | null {
  switch (command.kind) {
    case 'idle':
      return null;
    case 'sending':
      return text('sending');
    case 'done':
      return text('done');
    case 'offline':
      return text('needOnline');
    case 'ttl':
      return text('ttl');
    case 'blocked':
      return text('lookup');
    case 'invalid':
      return text('reason');
    case 'failed':
      return failureText(command.failure);
  }
}

function pending(command: Command): boolean {
  return (
    command.kind === 'ttl' ||
    command.kind === 'blocked' ||
    (command.kind === 'failed' && ['unknownOutcome', 'inProgress'].includes(command.failure.kind))
  );
}

function CommandNote({
  state,
  flow,
}: {
  state: FlowState;
  flow: RelocationFlow;
}): ReactElement | null {
  const message = commandText(state.command);
  if (message === null) return null;
  return (
    <View testID="command-note" accessibilityLiveRegion="polite" style={{ gap: space.s2 }}>
      <Text
        testID="command-text"
        style={{ color: state.command.kind === 'done' ? color.text : color.warning }}
      >
        {message}
      </Text>
      {state.intentState === null ? null : (
        <Text>{text('intentState', { state: state.intentState })}</Text>
      )}
      {pending(state.command) ? (
        <>
          {state.command.kind === 'ttl' ? null : (
            <ActionButton testID="retry" label={text('retry')} onPress={() => void flow.retry()} />
          )}
          <ActionButton
            testID="lookup"
            tone="plain"
            label={text('lookup')}
            onPress={() => void flow.lookup()}
          />
          <ActionButton
            testID="discard"
            tone="plain"
            label={text('discard')}
            onPress={() => flow.discard()}
          />
        </>
      ) : null}
    </View>
  );
}

function CreateForm({ state, flow }: { state: FlowState; flow: RelocationFlow }): ReactElement {
  return (
    <View style={{ gap: space.s2 }}>
      <Text accessibilityRole="header" style={{ fontWeight: '700', color: color.text }}>
        {text('createMove')}
      </Text>
      <TextInput
        testID="reason-input"
        accessibilityLabel={text('reason')}
        placeholder={text('reason')}
        value={state.draft.reason}
        onChangeText={(reason) => flow.edit({ ...state.draft, reason })}
        style={theme.field}
      />
      <CheckRow
        testID="consent-check"
        label={text('consent')}
        checked={state.draft.granted}
        onToggle={() => flow.edit({ ...state.draft, granted: !state.draft.granted })}
      />
      <ActionButton
        testID="create-move"
        label={text('createMove')}
        disabled={state.command.kind === 'sending'}
        onPress={() => void flow.create()}
      />
    </View>
  );
}

function Actions({
  read,
  state,
  flow,
  role,
}: {
  read: RelocationState;
  state: FlowState;
  flow: RelocationFlow;
  role: UserMe['role'];
}): ReactElement {
  const move = read.move;
  const idle = state.command.kind !== 'sending';
  return (
    <View style={{ gap: space.s2 }}>
      {move !== null && canApprove(role) && move.view.allowedActions.includes('APPROVE') ? (
        <ActionButton
          testID="approve-move"
          label={text('approve')}
          disabled={!idle}
          onPress={() => flow.askPin('approve')}
        />
      ) : null}
      {move !== null && canExecute(role) && move.view.allowedActions.includes('EXECUTE') ? (
        <ActionButton
          testID="execute-move"
          label={text('execute')}
          disabled={!idle}
          onPress={() => flow.askPin('execute')}
        />
      ) : null}
      {state.pinFor === null ? null : (
        <PinForm
          action={state.pinFor}
          message={state.pinMessage}
          lockedFor={state.lockedFor}
          onSubmit={(pin) => void flow.submitPin(pin)}
          onCancel={() => flow.cancelPin()}
        />
      )}
    </View>
  );
}

function Body(props: {
  read: RelocationState;
  state: FlowState;
  flow: RelocationFlow;
  role: UserMe['role'];
}): ReactElement {
  const { read, state, flow, role } = props;
  return (
    <>
      {read.detail === null ? null : (
        <>
          <Ladder steps={read.detail.ladderPreview} />
          <Candidates rows={read.detail.candidates} />
        </>
      )}
      {read.options === null ? null : (
        <Options
          view={read.options}
          picked={state.picked}
          canPick={canCreate(role) && read.move === null}
          onPick={(index) => flow.pick(index)}
        />
      )}
      {canCreate(role) && read.options !== null && read.move === null && state.picked !== null ? (
        <CreateForm state={state} flow={flow} />
      ) : null}
      {read.move === null ? null : <MoveSummary move={read.move} role={role} />}
      <Actions read={read} state={state} flow={flow} role={role} />
    </>
  );
}

function ReadNote({ read }: { read: RelocationState }): ReactElement | null {
  if (read.phase === 'idle' || read.phase === 'ready') return null;
  return (
    <Text
      testID="relocation-state"
      accessibilityLiveRegion="polite"
      style={{ color: color.textMuted }}
    >
      {text(read.phase === 'empty' ? 'ready' : read.phase)}
    </Text>
  );
}

export function RelocationScreen(props: RelocationScreenProps): ReactElement {
  const { flow, read, state } = useRelocation(props);
  const role = props.profile.role;
  const missing = !canReadCases(role) && props.context.bookingId === '';
  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <Text accessibilityRole="header" style={theme.title}>
        {text('moveTitle')}
      </Text>
      <Text style={theme.muted}>{text('moveHint')}</Text>
      {missing ? (
        <Text testID="no-booking" style={theme.alertDanger}>
          {text('noBooking')}
        </Text>
      ) : null}
      <ReadNote read={read} />
      {read.stale ? (
        <Text testID="relocation-stale" accessibilityLiveRegion="polite" style={theme.alertWarning}>
          {text('staleError', { time: read.syncedAt ?? '—' })}
        </Text>
      ) : null}
      {flow === null || state === null ? null : (
        <Body read={read} state={state} flow={flow} role={role} />
      )}
      {flow === null || state === null ? null : <CommandNote state={state} flow={flow} />}
      <ActionButton
        testID="relocation-back"
        tone="plain"
        label={text('back')}
        onPress={props.onBack}
      />
    </ScrollView>
  );
}
