/** Đặt PIN lần đầu (SCR-56): nhập 6 số hai lần khớp rồi gọi `PUT /auth/pin`. */
import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { color, space, touchTargetDp, typography } from '@pinehill/ui-native';
import { isApiError } from '@pinehill/api-client';
import { Session } from '../src/session';
import { t } from '../src/strings';

export interface PinSetupScreenProps {
  session: Session;
  currentPassword: string;
  onDone: () => void;
}

export default function PinSetupScreen({
  session,
  currentPassword,
  onDone,
}: PinSetupScreenProps): ReactElement {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (first !== second) {
        setError(t('pin.setup.mismatch'));
        return;
      }
      await session.setPin(first, currentPassword);
      onDone();
    } catch (cause) {
      setError(
        t('login.error', { code: isApiError(cause) ? (cause.code ?? 'UNKNOWN') : 'UNKNOWN' }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ padding: space.s4, gap: space.s3 }}>
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('pin.setup.title')}
      </Text>
      <Text style={{ color: color.textMuted }}>{t('pin.setup.hint')}</Text>
      <TextInput
        testID="pin-1"
        accessibilityLabel="PIN lần 1"
        value={first}
        onChangeText={setFirst}
        keyboardType="number-pad"
        maxLength={6}
        secureTextEntry
        style={{
          minHeight: touchTargetDp,
          borderWidth: 1,
          borderColor: color.border,
          paddingHorizontal: space.s3,
        }}
      />
      <TextInput
        testID="pin-2"
        accessibilityLabel="PIN lần 2"
        value={second}
        onChangeText={setSecond}
        keyboardType="number-pad"
        maxLength={6}
        secureTextEntry
        style={{
          minHeight: touchTargetDp,
          borderWidth: 1,
          borderColor: color.border,
          paddingHorizontal: space.s3,
        }}
      />
      {error === null ? null : (
        <Text accessibilityLiveRegion="polite" style={{ color: color.danger }}>
          {error}
        </Text>
      )}
      <Pressable
        testID="pin-submit"
        accessibilityRole="button"
        accessibilityLabel={t('pin.setup.title')}
        disabled={busy}
        onPress={() => void submit()}
        style={{
          minHeight: touchTargetDp,
          justifyContent: 'center',
          paddingHorizontal: space.s3,
          backgroundColor: color.primary,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: color.surface, fontWeight: '600', textAlign: 'center' }}>
          {busy ? t('state.loading') : t('pin.setup.title')}
        </Text>
      </Pressable>
    </View>
  );
}
