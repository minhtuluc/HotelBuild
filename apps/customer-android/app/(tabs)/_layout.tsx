import { Tabs } from 'expo-router';
import type { ReactElement } from 'react';
import { color } from '@pinehill/ui-native';
import { t } from '../../src/strings';

/** Khung tab journey khách (SCR-72): tìm phòng / đơn của tôi / tài khoản. */
export default function JourneyTabs(): ReactElement {
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: color.surface },
        headerTintColor: color.text,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: color.bg },
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border },
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.textMuted,
        // HB-249: chưa có bộ icon; ẩn ô icon để không hiện ký tự thay thế, nhãn chữ đủ rõ.
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: 15, fontWeight: '600' },
        tabBarLabelPosition: 'beside-icon',
      }}
    >
      <Tabs.Screen name="search" options={{ title: t('nav.search') }} />
      <Tabs.Screen name="bookings" options={{ title: t('nav.bookings') }} />
      <Tabs.Screen name="account" options={{ title: t('nav.account') }} />
    </Tabs>
  );
}
