/** Điều khiển dùng chung của SCR-65: vùng chạm ≥ 48 dp, nhãn trợ năng và trạng thái đầy đủ. */
import type { ReactElement } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
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

export function Choice({
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
      accessibilityState={{ selected, disabled }}
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

export function Field({
  testID,
  label,
  value,
  onChange,
  editable = true,
  keyboard = 'default',
  secure = false,
  maxLength,
}: {
  testID: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  editable?: boolean;
  keyboard?: 'default' | 'number-pad' | 'phone-pad';
  secure?: boolean;
  maxLength?: number;
}): ReactElement {
  return (
    <>
      <Text style={{ color: color.text }}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        value={value}
        editable={editable}
        keyboardType={keyboard}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        {...(maxLength === undefined ? {} : { maxLength })}
        onChangeText={onChange}
        style={{
          minHeight: touchTargetDp,
          paddingHorizontal: space.s3,
          borderWidth: 1,
          borderRadius: 8,
          color: color.text,
        }}
      />
    </>
  );
}
