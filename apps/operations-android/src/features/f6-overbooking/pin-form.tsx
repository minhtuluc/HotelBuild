/** Ô nhập PIN của SCR-63: che ký tự, giá trị chỉ ở state cục bộ của màn hình và bị xoá sau khi gửi (AC5). */
import { useState, type ReactElement } from 'react';
import { Text, TextInput, View } from 'react-native';
import { color, space, touchTargetDp } from '@pinehill/ui-native';
import { ActionButton } from '../../arrivals/controls';
import { f6Text as text } from './messages';
import type { PinAction, PinMessage } from './flow';

const MESSAGE = {
  wrong: 'pinWrong',
  locked: 'pinLocked',
  shape: 'pinShape',
  offline: 'needOnline',
  expired: 'expired',
  unavailable: 'error',
} as const;

export function PinForm(props: {
  action: PinAction;
  message: PinMessage;
  lockedFor: number | null;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [pin, setPin] = useState('');
  const label = props.action === 'approve' ? text('approve') : text('execute');
  const shown =
    props.message === null
      ? null
      : props.message === 'locked' && props.lockedFor !== null
        ? text('pinLockedFor', { seconds: props.lockedFor })
        : text(MESSAGE[props.message]);
  return (
    <View testID="pin-form" accessible style={{ gap: space.s2 }}>
      <Text accessibilityRole="header" style={{ fontWeight: '700', color: color.text }}>
        {text('pinTitle', { action: label })}
      </Text>
      <Text style={{ color: color.textMuted }}>{text('pinNote')}</Text>
      <TextInput
        testID="pin-input"
        accessibilityLabel={text('pin')}
        secureTextEntry
        autoFocus
        keyboardType="number-pad"
        maxLength={6}
        autoComplete="off"
        importantForAutofill="no"
        value={pin}
        onChangeText={setPin}
        style={{
          minHeight: touchTargetDp,
          borderWidth: 1,
          borderColor: color.border,
          borderRadius: 8,
          paddingHorizontal: space.s3,
        }}
      />
      {shown === null ? null : (
        <Text testID="pin-message" accessibilityLiveRegion="polite" style={{ color: color.danger }}>
          {shown}
        </Text>
      )}
      <ActionButton
        testID="pin-submit"
        label={text('pinConfirm')}
        onPress={() => {
          const entered = pin;
          setPin('');
          props.onSubmit(entered);
        }}
      />
      <ActionButton
        testID="pin-cancel"
        tone="plain"
        label={text('pinCancel')}
        onPress={() => {
          setPin('');
          props.onCancel();
        }}
      />
    </View>
  );
}
