import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { color, space, typography } from '@pinehill/ui-native';
import { t } from '../../src/strings';

/** Tab tài khoản — khung; hồ sơ khách thật ở HB-115. */
export default function AccountScreen(): ReactElement {
  return (
    <View style={{ flex: 1, padding: space.s4, gap: space.s3 }}>
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('journey.account.title')}
      </Text>
      <Text style={{ color: color.textMuted }}>{t('journey.account.placeholder')}</Text>
    </View>
  );
}
