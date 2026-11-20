/** Điều khiển dùng chung của SCR-57/58: vùng chạm ≥ 48 dp, nhãn trợ năng và trạng thái đầy đủ. */
import { actionButtonStyle, type ActionTone } from './controls-style';
import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
import { color, radius, space, touchTargetDp, fontFamily } from '@pinehill/ui-native';
import { theme } from '../theme';

export function ActionButton({
  testID,
  label,
  onPress,
  disabled = false,
  tone = 'primary',
}: {
  testID: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: ActionTone;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => actionButtonStyle(tone, disabled, pressed).container}
    >
      <Text style={actionButtonStyle(tone, disabled).label}>{label}</Text>
    </Pressable>
  );
}

export function CheckRow({
  testID,
  label,
  checked,
  disabled = false,
  onToggle,
}: {
  testID: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={{
        minHeight: touchTargetDp,
        justifyContent: 'center',
        paddingHorizontal: space.s3,
        backgroundColor: color.surface,
        borderWidth: checked ? 2 : 1,
        borderRadius: radius.md,
        borderColor: checked ? color.primary : color.border,
      }}
    >
      <Text style={[theme.body, checked ? { fontFamily: fontFamily.sansBold } : null]}>
        {checked ? '☑ ' : '☐ '}
        {label}
      </Text>
    </Pressable>
  );
}
