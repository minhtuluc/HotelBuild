/** Màn hình đăng nhập nội bộ Operations Android (SCR-56). */
import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { waitMessage } from '@pinehill/ui-native';
import { isApiError } from '@pinehill/api-client';
import { Session, PIN_LOCK_SECONDS } from '../src/session';
import { t } from '../src/strings';
import { theme } from '../src/theme';

export interface LoginScreenProps {
  session: Session;
  onAuthenticated: () => void;
}

export default function LoginScreen({ session, onAuthenticated }: LoginScreenProps): ReactElement {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await session.login(username, password);
      onAuthenticated();
    } catch (cause) {
      if (Session.isOffline(cause)) setError(t('login.offline'));
      else if (isApiError(cause) && cause.knownCode === 'E_AUTH_ACCOUNT_LOCKED') {
        setError(
          waitMessage('E_AUTH_ACCOUNT_LOCKED', cause.retryAfterSeconds ?? PIN_LOCK_SECONDS) ??
            t('login.error', { code: '401' }),
        );
      } else {
        setError(
          t('login.error', { code: isApiError(cause) ? (cause.code ?? 'UNKNOWN') : 'UNKNOWN' }),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={theme.screen}>
      <Text style={theme.title}>{t('login.title')}</Text>
      <TextInput
        testID="username"
        accessibilityLabel={t('login.username')}
        placeholder={t('login.username')}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        style={theme.field}
      />
      <TextInput
        testID="password"
        accessibilityLabel={t('login.password')}
        placeholder={t('login.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={theme.field}
      />
      {error === null ? null : (
        <Text accessibilityLiveRegion="polite" style={theme.alertDanger}>
          {error}
        </Text>
      )}
      <Pressable
        testID="login-submit"
        accessibilityRole="button"
        accessibilityLabel={t('login.submit')}
        disabled={busy}
        onPress={() => void submit()}
        style={theme.buttonPrimary}
      >
        <Text style={theme.buttonPrimaryText}>{busy ? t('state.loading') : t('login.submit')}</Text>
      </Pressable>
    </View>
  );
}
