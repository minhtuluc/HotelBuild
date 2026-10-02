/** Màn hình đăng nhập nội bộ Operations Android (SCR-56). */
import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { color, space, touchTargetDp, typography } from '@pinehill/ui-native';
import { isApiError } from '@pinehill/api-client';
import { Session, PIN_LOCK_SECONDS } from '../src/session';
import { waitMessage } from '@pinehill/ui-native';
import { t } from '../src/strings';

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
    <View style={{ padding: space.s4, gap: space.s3 }}>
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('login.title')}
      </Text>
      <TextInput
        testID="username"
        accessibilityLabel={t('login.username')}
        placeholder={t('login.username')}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        style={{
          minHeight: touchTargetDp,
          borderWidth: 1,
          borderColor: color.border,
          paddingHorizontal: space.s3,
        }}
      />
      <TextInput
        testID="password"
        accessibilityLabel={t('login.password')}
        placeholder={t('login.password')}
        value={password}
        onChangeText={setPassword}
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
        testID="login-submit"
        accessibilityRole="button"
        accessibilityLabel={t('login.submit')}
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
          {busy ? t('state.loading') : t('login.submit')}
        </Text>
      </Pressable>
    </View>
  );
}
