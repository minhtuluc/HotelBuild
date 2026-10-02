/** Màn hình đăng nhập/đăng ký/khôi phục phiên cho khách (SCR-71). */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { color, space, touchTargetDp, typography, waitMessage } from '@pinehill/ui-native';
import { isApiError } from '@pinehill/api-client';
import { createSession } from '../src/session-factory';
import { Session } from '../src/session';
import { t } from '../src/strings';

const fieldStyle = {
  minHeight: touchTargetDp,
  borderWidth: 1,
  borderColor: color.border,
  paddingHorizontal: space.s3,
};

export default function GuestScreen(): ReactElement {
  const session = useMemo(createSession, []);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [booted, setBooted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setAuthenticated(await session.silentRefresh().catch(() => false));
      setBooted(true);
    })();
  }, [session]);

  function mapError(cause: unknown): string {
    if (!isApiError(cause)) return t('guest.error', { code: 'UNKNOWN' });
    if (cause.knownCode === 'E_AUTH_PHONE_REGISTERED') return t('guest.phoneRegistered');
    const code = cause.code ?? 'UNKNOWN';
    if (cause.knownCode === 'E_AUTH_ACCOUNT_LOCKED' || cause.knownCode === 'E_GEN_RATE_LIMITED') {
      return waitMessage(code, cause.retryAfterSeconds ?? 900) ?? t('guest.error', { code });
    }
    return t('guest.error', { code });
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await session.register({
          phone,
          fullName,
          password,
          consentMarketing: true,
          consentVersion: '2026-10',
        });
      } else {
        await session.login(phone, password);
      }
      setAuthenticated(true);
    } catch (cause) {
      if (Session.isOffline(cause)) setError(t('guest.offline'));
      else setError(mapError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function forgot(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await session.passwordResetRequest(phone);
      setError(t('guest.forgot.sent'));
    } catch (cause) {
      if (Session.isOffline(cause)) setError(t('guest.offline'));
      else setError(mapError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!booted) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel="Đang khôi phục phiên" />
      </View>
    );
  }
  if (authenticated) {
    return (
      <View style={{ padding: space.s4, gap: space.s3 }}>
        <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
          {t('home.title')}
        </Text>
        <Pressable
          testID="logout"
          accessibilityRole="button"
          accessibilityLabel={t('home.logout')}
          onPress={() => void session.logout().then(() => setAuthenticated(false))}
          style={{ minHeight: touchTargetDp, justifyContent: 'center' }}
        >
          <Text style={{ color: color.danger }}>{t('home.logout')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ padding: space.s4, gap: space.s3 }}>
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('guest.title')}
      </Text>
      <TextInput
        testID="phone"
        accessibilityLabel={t('guest.phone')}
        placeholder={t('guest.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        style={fieldStyle}
      />
      {mode === 'register' ? (
        <TextInput
          testID="fullname"
          accessibilityLabel={t('guest.fullName')}
          placeholder={t('guest.fullName')}
          value={fullName}
          onChangeText={setFullName}
          style={fieldStyle}
        />
      ) : null}
      <TextInput
        testID="password"
        accessibilityLabel={t('guest.password')}
        placeholder={t('guest.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={fieldStyle}
      />
      {error === null ? null : (
        <Text accessibilityLiveRegion="polite" style={{ color: color.danger }}>
          {error}
        </Text>
      )}
      <Pressable
        testID="submit"
        accessibilityRole="button"
        accessibilityLabel={mode === 'login' ? t('guest.login') : t('guest.register')}
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
          {busy ? t('state.loading') : mode === 'login' ? t('guest.login') : t('guest.register')}
        </Text>
      </Pressable>
      <Pressable
        testID="toggle-mode"
        accessibilityRole="button"
        accessibilityLabel={mode === 'login' ? t('guest.register') : t('guest.login')}
        onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        <Text style={{ color: color.primary }}>
          {mode === 'login' ? t('guest.register') : t('guest.login')}
        </Text>
      </Pressable>
      <Pressable
        testID="forgot"
        accessibilityRole="button"
        accessibilityLabel={t('guest.forgot')}
        onPress={() => void forgot()}
      >
        <Text style={{ color: color.primary }}>{t('guest.forgot')}</Text>
      </Pressable>
    </View>
  );
}
