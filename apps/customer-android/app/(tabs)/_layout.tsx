import { Tabs } from 'expo-router';
import type { ReactElement } from 'react';
import { t } from '../../src/strings';
import { tabScreenOptions } from '../../src/theme';

/** Khung tab journey khách (SCR-72): tìm phòng / khám phá (HB-277) / đơn của tôi / tài khoản. */
export default function JourneyTabs(): ReactElement {
  return (
    <Tabs
      screenOptions={{
        ...tabScreenOptions,
        // HB-249: chưa có bộ icon; ẩn ô icon để không hiện ký tự thay thế, nhãn chữ đủ rõ.
        tabBarIconStyle: { display: 'none' },
        tabBarLabelPosition: 'below-icon',
        // HB-277: bốn tab — chữ 15sp để nhãn dài ("My bookings", "Мои брони") không bị cắt.
        tabBarLabelStyle: { ...tabScreenOptions.tabBarLabelStyle, fontSize: 15 },
      }}
    >
      <Tabs.Screen
        name="search"
        options={{ title: t('nav.search'), tabBarLabel: t('nav.search') }}
      />
      <Tabs.Screen
        name="explore"
        options={{ title: t('screen.explore'), tabBarLabel: t('screen.explore') }}
      />
      <Tabs.Screen
        name="bookings"
        options={{ title: t('nav.bookings'), tabBarLabel: t('nav.bookings') }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: t('nav.account'), tabBarLabel: t('nav.account') }}
      />
    </Tabs>
  );
}
