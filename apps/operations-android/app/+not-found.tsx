import { Link } from 'expo-router';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { color, space, touchTargetDp } from '@pinehill/ui-native';
import { t } from '../src/strings';
import { theme } from '../src/theme';

/** Tuyến không khớp: đường thoát an toàn thay vì màn hình trắng (F0-04). */
export default function NotFoundScreen(): ReactElement {
  return (
    <View style={theme.screen}>
      <Text accessibilityRole="header" style={theme.sectionTitle}>
        {t('access.denied.title')}
      </Text>
      <Text style={theme.body}>{t('access.denied.body')}</Text>
      <Link
        href="/"
        accessibilityLabel={t('access.denied.back')}
        style={{
          minHeight: touchTargetDp,
          color: color.primary,
          fontWeight: '600',
          paddingTop: space.s3,
        }}
      >
        {t('access.denied.back')}
      </Link>
    </View>
  );
}
