/** HB-249: lời nhắc đăng nhập dùng chung cho các màn cần tài khoản (Tài khoản, Đơn của tôi, giữ chỗ). */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { space } from '@pinehill/ui-native';
import { LOGIN_ROUTE } from './navigation';
import { t, type MessageKey } from './strings';
import { theme } from './theme';

export function LoginPrompt({ hint }: { hint: MessageKey }): ReactElement {
  const router = useRouter();
  return (
    <View style={{ gap: space.s3 }}>
      <Text style={theme.muted}>{t(hint)}</Text>
      <Pressable
        testID="login-prompt"
        accessibilityRole="button"
        accessibilityLabel={t('account.login')}
        onPress={() => router.push(LOGIN_ROUTE)}
        style={theme.buttonPrimary}
      >
        <Text style={theme.buttonPrimaryText}>{t('account.login')}</Text>
      </Pressable>
    </View>
  );
}
