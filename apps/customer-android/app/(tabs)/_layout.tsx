import { Tabs } from 'expo-router';
import type { ReactElement } from 'react';
import { t } from '../../src/strings';
import { tabScreenOptions } from '../../src/theme';

/** Khung tab journey khách (SCR-72): tìm phòng / đơn của tôi / tài khoản. */
export default function JourneyTabs(): ReactElement {
  return (
    <Tabs
      screenOptions={{
        ...tabScreenOptions,
        // HB-249: chưa có bộ icon; ẩn ô icon để không hiện ký tự thay thế, nhãn chữ đủ rõ.
        tabBarIconStyle: { display: 'none' },
        tabBarLabelPosition: 'beside-icon',
      }}
    >
      <Tabs.Screen name="search" options={{ title: t('nav.search') }} />
      <Tabs.Screen name="bookings" options={{ title: t('nav.bookings') }} />
      <Tabs.Screen name="account" options={{ title: t('nav.account') }} />
    </Tabs>
  );
}
