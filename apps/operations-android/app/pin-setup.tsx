/** Đặt PIN lần đầu (SCR-56): nhập 6 số hai lần khớp rồi gọi `PUT /auth/pin`. */
import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { isApiError } from '@pinehill/api-client';
import { Session } from '../src/session';
import { t } from '../src/strings';
import { theme } from '../src/theme';

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
    <View style={theme.screen}>
      <Text style={theme.title}>{t('pin.setup.title')}</Text>
      <Text style={theme.muted}>{t('pin.setup.hint')}</Text>
      <TextInput
        testID="pin-1"
        accessibilityLabel={t('pin.setup.entry', { number: 1 })}
        value={first}
        onChangeText={setFirst}
        keyboardType="number-pad"
        maxLength={6}
        secureTextEntry
        style={theme.field}
      />
      <TextInput
        testID="pin-2"
        accessibilityLabel={t('pin.setup.entry', { number: 2 })}
        value={second}
        onChangeText={setSecond}
        keyboardType="number-pad"
        maxLength={6}
        secureTextEntry
        style={theme.field}
      />
      {error === null ? null : (
        <Text accessibilityLiveRegion="polite" style={theme.alertDanger}>
          {error}
        </Text>
      )}
      <Pressable
        testID="pin-submit"
        accessibilityRole="button"
        accessibilityLabel={t('pin.setup.title')}
        disabled={busy}
        onPress={() => void submit()}
        style={theme.buttonPrimary}
      >
        <Text style={theme.buttonPrimaryText}>
          {busy ? t('state.loading') : t('pin.setup.title')}
        </Text>
      </Pressable>
    </View>
  );
}
