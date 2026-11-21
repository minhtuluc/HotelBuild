import { Stack, type ErrorBoundaryProps } from 'expo-router';
import type { ReactElement } from 'react';
import { NativeErrorPanel, useStatusBarStyle } from '@pinehill/ui-native';
import { useBrandFonts } from '@pinehill/ui-native/fonts';
import { ROUTE_TITLES } from '../src/stages';
import { t } from '../src/strings';
import { stackScreenOptions } from '../src/theme';

/** Biên lỗi của router (F0-04): không hiện stack trace, chỉ câu chữ an toàn. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps): ReactElement {
  return <NativeErrorPanel t={t} onRetry={() => void retry()} />;
}

/** HB-252: mỗi route có tiêu đề từ catalog thay vì tên file; `index` tự đặt lại theo bước đang mở. */
export default function RootLayout(): ReactElement {
  // HB-274: header bảng ga đen ⇒ chữ thanh trạng thái sáng (cùng cơ chế đặt lại của HB-267).
  useStatusBarStyle('light-content');
  // Font thương hiệu là asset cục bộ (vài trăm ms); lỗi nạp thì vẫn vẽ bằng font hệ thống.
  if (!useBrandFonts()) return <></>;
  return (
    <Stack screenOptions={stackScreenOptions}>
      {Object.entries(ROUTE_TITLES).map(([name, title]) => (
        <Stack.Screen key={name} name={name} options={{ title }} />
      ))}
    </Stack>
  );
}
