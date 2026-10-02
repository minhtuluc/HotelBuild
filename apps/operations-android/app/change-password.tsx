/** Đổi mật khẩu tạm ở lần đăng nhập đầu (SCR-56, QĐ-03 quyết định 8). */
import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { color, space, touchTargetDp, typography } from '@pinehill/ui-native';
import { isApiError } from '@pinehill/api-client';
import { Session } from '../src/session';
import { t } from '../src/strings';

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
    <View style={{ padding: space.s4, gap: space.s3 }}>
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('changePassword.title')}
      </Text>
      <Text style={{ color: color.textMuted }}>{t('changePassword.required')}</Text>
      <TextInput
        testID="current-password"
        accessibilityLabel={t('changePassword.current')}
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        style={{
          minHeight: touchTargetDp,
          borderWidth: 1,
          borderColor: color.border,
          paddingHorizontal: space.s3,
        }}
      />
      <TextInput
        testID="new-password"
        accessibilityLabel={t('changePassword.next')}
        value={next}
        onChangeText={setNext}
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
        testID="change-submit"
        accessibilityRole="button"
        accessibilityLabel={t('changePassword.submit')}
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
          {busy ? t('state.loading') : t('changePassword.submit')}
        </Text>
      </Pressable>
    </View>
  );
}
