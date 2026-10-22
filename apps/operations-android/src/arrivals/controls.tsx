/** Điều khiển dùng chung của SCR-57/58: vùng chạm ≥ 48 dp, nhãn trợ năng và trạng thái đầy đủ. */
import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
import { color, space, touchTargetDp } from '@pinehill/ui-native';

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
  tone?: 'primary' | 'plain';
}): ReactElement {
  const filled = tone === 'primary';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: touchTargetDp,
        justifyContent: 'center',
        paddingHorizontal: space.s3,
        borderRadius: 8,
        ...(filled
          ? { backgroundColor: color.primary }
          : { borderWidth: 1, borderColor: color.border }),
        ...(disabled ? { opacity: 0.5 } : {}),
      }}
    >
      <Text
        style={{
          textAlign: 'center',
          fontWeight: '600',
          color: filled ? color.surface : color.primary,
        }}
      >
        {label}
      </Text>
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
        borderWidth: 1,
        borderRadius: 8,
        borderColor: checked ? color.primary : color.border,
      }}
    >
      <Text style={{ color: color.text, fontWeight: checked ? '700' : '400' }}>
        {checked ? '☑ ' : '☐ '}
        {label}
      </Text>
    </Pressable>
  );
}
