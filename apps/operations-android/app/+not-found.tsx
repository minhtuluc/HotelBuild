import { Link } from 'expo-router';
import type { ReactElement } from 'react';
import { Text } from 'react-native';
import { t } from '../src/demo';

/** Tuyến không khớp: đường thoát an toàn thay vì màn hình trắng (F0-04). */
export default function NotFoundScreen(): ReactElement {
  return (
    <>
      <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700' }}>
        {t('access.denied.title')}
      </Text>
      <Text>{t('access.denied.body')}</Text>
      <Link href="/" accessibilityLabel={t('access.denied.back')}>
        {t('access.denied.back')}
      </Link>
    </>
  );
}
