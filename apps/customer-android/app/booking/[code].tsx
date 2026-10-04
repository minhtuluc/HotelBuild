import { useLocalSearchParams } from 'expo-router';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { color, space, typography } from '@pinehill/ui-native';
import { t } from '../../src/strings';

/** Đích deep link `pinehill-customer://booking/<code>` — chi tiết thật ở HB-086. */
export default function BookingScreen(): ReactElement {
  const { code } = useLocalSearchParams<{ code: string }>();
  return (
    <View style={{ flex: 1, padding: space.s4, gap: space.s3 }}>
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('booking.title', { code: code ?? '' })}
      </Text>
      <Text style={{ color: color.textMuted }}>{t('booking.placeholder')}</Text>
    </View>
  );
}
