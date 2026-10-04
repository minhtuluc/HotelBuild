import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { color, space, typography } from '@pinehill/ui-native';
import { t } from '../../src/strings';

/** Tab đơn của tôi — khung; danh sách thật ở HB-079/HB-113. */
export default function BookingsScreen(): ReactElement {
  return (
    <View style={{ flex: 1, padding: space.s4, gap: space.s3 }}>
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('journey.bookings.title')}
      </Text>
      <Text style={{ color: color.textMuted }}>{t('journey.bookings.placeholder')}</Text>
    </View>
  );
}
