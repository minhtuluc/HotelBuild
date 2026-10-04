import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { color, space, typography } from '@pinehill/ui-native';
import { t } from '../../src/strings';

/** Tab tìm phòng — khung; luồng thật (gọi `createPublicJourneyApi().availability`) ở HB-085. */
export default function SearchScreen(): ReactElement {
  return (
    <View style={{ flex: 1, padding: space.s4, gap: space.s3 }}>
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('journey.search.title')}
      </Text>
      <Text style={{ color: color.textMuted }}>{t('journey.search.placeholder')}</Text>
    </View>
  );
}
