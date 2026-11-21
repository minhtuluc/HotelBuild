import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { useEffect, useState, type ReactElement } from 'react';
import { NativeErrorPanel, useStatusBarStyle } from '@pinehill/ui-native';
import { useBrandFonts } from '@pinehill/ui-native/fonts';
import { JOURNEY_TABS, SCREEN_TITLES } from '../src/navigation';
import { t } from '../src/strings';
import { stackScreenOptions } from '../src/theme';
import { currentLocale, deviceLocaleTag, restoreLocale, subscribeLocale } from '../src/i18n/locale';
import { secureStorage } from '../src/storage-device.native';

/**
 * HB-275: khôi phục ngôn ngữ (đã lưu, nếu không thì theo máy) trước khi vẽ, và vẽ lại cả cây khi khách đổi
 * ngôn ngữ (`key` theo locale) để mọi `t()` đọc catalog mới.
 */
function useAppLocale(): string | null {
  const [locale, setLocale] = useState<string | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeLocale(() => setLocale(currentLocale()));
    void restoreLocale(secureStorage(), deviceLocaleTag()).then(setLocale);
    return unsubscribe;
  }, []);
  return locale;
}

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
  const fontsReady = useBrandFonts();
  const locale = useAppLocale();
  if (!fontsReady || locale === null) return <></>;
  return (
    <Stack key={locale} screenOptions={stackScreenOptions}>
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
