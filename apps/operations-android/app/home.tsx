/** Màn chính sau khi đăng nhập: demo mở khoá PIN và đăng xuất (SCR-56, §8.1/§8.3). */
import { useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { color, space, touchTargetDp, typography, waitMessage } from '@pinehill/ui-native';
import { isApiError } from '@pinehill/api-client';
import { Session, PIN_LOCK_SECONDS } from '../src/session';
import { t } from '../src/strings';

export interface HomeScreenProps {
  session: Session;
  onLogout: () => void;
  onTasks?: () => void;
}

export default function HomeScreen({ session, onLogout, onTasks }: HomeScreenProps): ReactElement {
  const [pinResult, setPinResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPinDemo(): Promise<void> {
    setBusy(true);
    setPinResult(null);
    try {
      await session.verifyPin('123456', undefined);
      session.clearPinToken();
      setPinResult(t('home.pinDemo.ok', { purpose: 'demo' }));
    } catch (cause) {
      if (Session.isOffline(cause)) setPinResult(t('login.offline'));
      else if (isApiError(cause) && cause.knownCode === 'E_AUTH_PIN_LOCKED') {
        setPinResult(
          waitMessage('E_AUTH_PIN_LOCKED', cause.retryAfterSeconds ?? PIN_LOCK_SECONDS) ??
            t('pin.locked'),
        );
      } else {
        setPinResult(
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
        {t('home.title')}
      </Text>
      {onTasks ? (
        <Pressable
          testID="open-housekeeping"
          accessibilityRole="button"
          accessibilityLabel={t('home.tasks')}
          onPress={onTasks}
          style={{
            minHeight: touchTargetDp,
            justifyContent: 'center',
            paddingHorizontal: space.s3,
          }}
        >
          <Text style={{ color: color.primary }}>{t('home.tasks')}</Text>
        </Pressable>
      ) : null}
      <Pressable
        testID="pin-demo"
        accessibilityRole="button"
        accessibilityLabel={t('home.pinDemo')}
        disabled={busy}
        onPress={() => void runPinDemo()}
        style={{
          minHeight: touchTargetDp,
          justifyContent: 'center',
          paddingHorizontal: space.s3,
          backgroundColor: color.primary,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: color.surface, fontWeight: '600', textAlign: 'center' }}>
          {busy ? t('state.loading') : t('home.pinDemo')}
        </Text>
      </Pressable>
      {pinResult === null ? null : (
        <Text accessibilityLiveRegion="polite" style={{ color: color.textMuted }}>
          {pinResult}
        </Text>
      )}
      <Pressable
        testID="logout"
        accessibilityRole="button"
        accessibilityLabel={t('home.logout')}
        onPress={() => void session.logout().then(onLogout)}
        style={{ minHeight: touchTargetDp, justifyContent: 'center', paddingHorizontal: space.s3 }}
      >
        <Text style={{ color: color.danger }}>{t('home.logout')}</Text>
      </Pressable>
    </View>
  );
}
