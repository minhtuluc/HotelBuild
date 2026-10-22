/** Điều khiển riêng của SCR-59/61 (nhóm chọn một, ô PIN); nút và ô chọn dùng lại từ `arrivals/controls`. */
import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { color, space, touchTargetDp } from '@pinehill/ui-native';
import { ActionButton } from '../arrivals/controls';
import type { ActionFailure } from '../arrivals/model';
import { pinIssue } from './model';
import { stayText as text } from './messages';
import type { SubmitOutcome, UnlockOutcome } from './writer';

export function ChoiceRow({
  testID,
  label,
  selected,
  disabled = false,
  onSelect,
}: {
  testID: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onSelect}
      style={{
        minHeight: touchTargetDp,
        justifyContent: 'center',
        paddingHorizontal: space.s3,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: selected ? color.primary : color.border,
      }}
    >
      <Text style={{ color: color.text, fontWeight: selected ? '700' : '400' }}>
        {selected ? '◉ ' : '○ '}
        {label}
      </Text>
    </Pressable>
  );
}

export function FailureNotice({ failure }: { failure: ActionFailure }): ReactElement {
  switch (failure.kind) {
    case 'rejected':
      return (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ gap: space.s1 }}>
          <Text style={{ color: color.danger, fontWeight: '700' }}>{text('rejected')}</Text>
          <Text>{text('rejectedCode', { code: failure.code })}</Text>
          <Text>{text('rejectedReason', { reason: failure.reason })}</Text>
        </View>
      );
    case 'conflict':
      return (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {text('conflict')}
        </Text>
      );
    case 'forbidden':
      return (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {text('failForbidden')}
        </Text>
      );
    case 'unknownOutcome':
      return (
        <Text accessibilityRole="alert" style={{ color: color.warning }}>
          {text('unknownOutcome', { reference: failure.reference })}
        </Text>
      );
  }
}

export interface Unlockable {
  unlock(pin: string, bookingId: string): Promise<UnlockOutcome>;
}

export function pinMessage(outcome: UnlockOutcome | { kind: 'format' }): string | null {
  switch (outcome.kind) {
    case 'format':
      return text('pinFormat');
    case 'wrong':
      return text('pinWrong');
    case 'offline':
      return text('offlineBlock');
    case 'expired':
      return text('balanceExpired');
    case 'unavailable':
      return text('pinUnavailable');
    case 'locked':
      return outcome.retryAfterSeconds === null
        ? text('pinLockedNoTime')
        : text('pinLocked', { minutes: Math.ceil(outcome.retryAfterSeconds / 60) });
    default:
      return null;
  }
}

/** Ô PIN 6 số: PIN chỉ nằm trong state tới khi gửi `pin/verify` rồi bị xoá; không log, không lưu. */
export function PinPanel({
  bookingId,
  writer,
  unlocked,
  onUnlocked,
}: {
  bookingId: string;
  writer: Unlockable | null;
  unlocked: boolean;
  onUnlocked: () => void;
}): ReactElement {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (unlocked)
    return (
      <Text testID="pin-unlocked" accessibilityLiveRegion="polite" style={{ color: color.success }}>
        {text('pinUnlocked')}
      </Text>
    );
  const unlock = async (): Promise<void> => {
    if (writer === null) return;
    if (pinIssue(pin) !== null) {
      setMessage(pinMessage({ kind: 'format' }));
      return;
    }
    setBusy(true);
    const outcome = await writer.unlock(pin, bookingId);
    setPin('');
    setBusy(false);
    setMessage(pinMessage(outcome));
    if (outcome.kind === 'unlocked') onUnlocked();
  };
  return (
    <View style={{ gap: space.s2 }}>
      <Text style={{ fontWeight: '700' }}>{text('pinTitle')}</Text>
      <Text style={{ color: color.textMuted }}>{text('pinHint')}</Text>
      <TextInput
        testID="pin-input"
        accessibilityLabel={text('pinLabel')}
        value={pin}
        maxLength={6}
        secureTextEntry
        keyboardType="number-pad"
        editable={!busy}
        autoCorrect={false}
        onChangeText={setPin}
        style={{
          minHeight: touchTargetDp,
          paddingHorizontal: space.s3,
          borderWidth: 1,
          borderRadius: 8,
          color: color.text,
        }}
      />
      {message === null ? null : (
        <Text testID="pin-message" accessibilityRole="alert" style={{ color: color.danger }}>
          {message}
        </Text>
      )}
      <ActionButton
        testID="pin-unlock"
        label={text('pinUnlock')}
        tone="plain"
        disabled={busy}
        onPress={() => void unlock()}
      />
    </View>
  );
}

export type Outcome<R> = Exclude<SubmitOutcome<R>, { kind: 'closed' }>;

/** Thông báo cho kết quả không thành công của lệnh 🔒 (thành công do màn hình riêng hiển thị). */
export function ResultNotice<R>({ result }: { result: Outcome<R> | null }): ReactElement | null {
  if (result === null || result.kind === 'done') return null;
  if (result.kind === 'failed') return <FailureNotice failure={result.failure} />;
  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ color: color.danger }}
    >
      {result.kind === 'offline' ? text('offlineBlock') : text('pinRequired')}
    </Text>
  );
}
