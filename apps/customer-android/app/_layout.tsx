import { Stack, type ErrorBoundaryProps } from 'expo-router';
import type { ReactElement } from 'react';
import { NativeErrorPanel, useStatusBarStyle } from '@pinehill/ui-native';
import { useBrandFonts } from '@pinehill/ui-native/fonts';
import { JOURNEY_TABS, SCREEN_TITLES } from '../src/navigation';
import { t } from '../src/strings';
import { stackScreenOptions } from '../src/theme';

/** Biên lỗi của router (F0-04): không hiện stack trace, chỉ câu chữ an toàn. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps): ReactElement {
  return <NativeErrorPanel t={t} onRetry={() => void retry()} />;
}

/** HB-249: route gốc ẩn header (tab tự có header); các màn còn lại lấy tiêu đề từ catalog. */
const STACKLESS = new Set<string>(['index', '(tabs)', ...JOURNEY_TABS]);

export default function RootLayout(): ReactElement {
  // HB-273: header bảng ga đen ⇒ chữ thanh trạng thái sáng (cùng cơ chế đặt lại của HB-267).
  useStatusBarStyle('light-content');
  // Font thương hiệu là asset cục bộ (vài trăm ms); lỗi nạp thì vẫn vẽ bằng font hệ thống.
  if (!useBrandFonts()) return <></>;
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {Object.entries(SCREEN_TITLES)
        .filter(([name]) => !STACKLESS.has(name))
        .map(([name, key]) => (
          <Stack.Screen key={name} name={name} options={{ title: t(key) }} />
        ))}
    </Stack>
  );
}
