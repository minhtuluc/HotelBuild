/** Đổi mật khẩu tạm ở lần đăng nhập đầu (SCR-56, QĐ-03 quyết định 8). */
import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { isApiError } from '@pinehill/api-client';
import { Session } from '../src/session';
import { t } from '../src/strings';
import { theme } from '../src/theme';

export interface ChangePasswordScreenProps {
  session: Session;
  onDone: (currentPassword: string) => void;
}

export default function ChangePasswordScreen({
  session,
  onDone,
}: ChangePasswordScreenProps): ReactElement {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await session.changePassword(current, next);
      onDone(current);
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
      <Text style={theme.title}>{t('changePassword.title')}</Text>
      <Text style={theme.muted}>{t('changePassword.required')}</Text>
      <TextInput
        testID="current-password"
        accessibilityLabel={t('changePassword.current')}
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        style={theme.field}
      />
      <TextInput
        testID="new-password"
        accessibilityLabel={t('changePassword.next')}
        value={next}
        onChangeText={setNext}
        secureTextEntry
        style={theme.field}
      />
      {error === null ? null : (
        <Text accessibilityLiveRegion="polite" style={theme.alertDanger}>
          {error}
        </Text>
      )}
      <Pressable
        testID="change-submit"
        accessibilityRole="button"
        accessibilityLabel={t('changePassword.submit')}
        disabled={busy}
        onPress={() => void submit()}
        style={theme.buttonPrimary}
      >
        <Text style={theme.buttonPrimaryText}>
          {busy ? t('state.loading') : t('changePassword.submit')}
        </Text>
      </Pressable>
    </View>
  );
}
