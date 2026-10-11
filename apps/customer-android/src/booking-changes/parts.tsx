import type { ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { color, radius, space, touchTargetDp, formatDateTimeVn } from '@pinehill/ui-native';
import { formatVnd } from '../search';
import { changeText } from './strings';
import type { ChangeDraft, ChangeKind, ChangePreview, ChangeResult } from './types';

export function ChangeButton({
  label,
  disabled = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress(): void;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: touchTargetDp,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: color.borderStrong,
        borderRadius: radius.sm,
        padding: space.s2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: color.primary }}>{label}</Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  disabled,
  onChangeText,
  multiline = false,
}: {
  label: string;
  value: string;
  disabled: boolean;
  multiline?: boolean;
  onChangeText(value: string): void;
}): ReactElement {
  return (
    <View style={{ gap: space.s1 }}>
      <Text style={{ color: color.text }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        maxLength={multiline ? 500 : 150}
        autoCapitalize="none"
        style={{
          minHeight: touchTargetDp,
          color: color.text,
          borderColor: color.borderStrong,
          borderWidth: 1,
          borderRadius: radius.sm,
          padding: space.s2,
        }}
      />
    </View>
  );
}
export function ChangeForm({
  kind,
  draft,
  disabled,
  edit,
}: {
  kind: ChangeKind;
  draft: ChangeDraft;
  disabled: boolean;
  edit(draft: ChangeDraft): void;
}): ReactElement {
  return (
    <View style={{ gap: space.s3 }}>
      {kind === 'cancel' ? (
        <Text style={{ color: color.text }}>
          {changeText('guestReason')} · {changeText('contactStaff')}
        </Text>
      ) : (
        <>
          <Field
            label={changeText('checkIn')}
            value={draft.checkIn}
            disabled={disabled}
            onChangeText={(checkIn) => edit({ ...draft, checkIn })}
          />
          <Field
            label={changeText('checkOut')}
            value={draft.checkOut}
            disabled={disabled}
            onChangeText={(checkOut) => edit({ ...draft, checkOut })}
          />
        </>
      )}
      <Field
        label={changeText('note')}
        value={draft.note}
        disabled={disabled}
        multiline
        onChangeText={(note) => edit({ ...draft, note })}
      />
    </View>
  );
}
export function PreviewBody({ preview }: { preview: ChangePreview }): ReactElement {
  if (preview.kind === 'reschedule')
    return (
      <View style={{ gap: space.s2 }}>
        <Text style={{ color: color.text }}>
          {changeText('quoted', { amount: formatVnd(preview.data.total) })}
        </Text>
        <Text style={{ color: color.text }}>
          {changeText('expiry', { time: formatDateTimeVn(preview.data.expiresAt) })}
        </Text>
        <Text style={{ color: color.warning }}>{changeText('roomPriceOnly')}</Text>
        {preview.data.warnings.map((warning, index) => (
          <Text key={index} accessibilityRole="alert" style={{ color: color.warning }}>
            {warning}
          </Text>
        ))}
      </View>
    );
  const data = preview.data.cancellation;
  return (
    <View style={{ gap: space.s2 }}>
      <Text style={{ color: color.text }}>
        {changeText('applied', {
          tier: data.appliedTierId,
          percent: String(data.refundPercent),
          hours: data.hoursBeforeCheckIn.toFixed(1),
        })}
      </Text>
      {(
        [
          ['paid', data.paidAmount],
          ['requested', data.requestedAmount],
          ['fee', data.refundFee],
          ['penalty', data.penaltyAmount],
        ] as const
      ).map(([key, amount]) => (
        <Text key={key} style={{ color: color.text }}>
          {changeText(key, { amount: formatVnd(amount) })}
        </Text>
      ))}
      {preview.data.warnings?.map((warning, index) => (
        <Text key={index} accessibilityRole="alert" style={{ color: color.warning }}>
          {warning}
        </Text>
      ))}
    </View>
  );
}
export function ResultBody({ result }: { result: ChangeResult }): ReactElement {
  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ color: color.success }}
    >
      {result.kind === 'cancel'
        ? changeText('doneCancel', {
            status: result.data.refundRequest?.status ?? changeText('noRefund'),
          })
        : changeText('doneReschedule', {
            checkIn: result.data.checkIn,
            checkOut: result.data.checkOut,
          })}
    </Text>
  );
}
