import { Stack, type ErrorBoundaryProps } from 'expo-router';
import type { ReactElement } from 'react';
import { NativeErrorPanel, useDarkStatusBar } from '@pinehill/ui-native';
import { ROUTE_TITLES } from '../src/stages';
import { t } from '../src/strings';
import { stackScreenOptions } from '../src/theme';

/** Biên lỗi của router (F0-04): không hiện stack trace, chỉ câu chữ an toàn. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps): ReactElement {
  return <NativeErrorPanel t={t} onRetry={() => void retry()} />;
}

/** HB-252: mỗi route có tiêu đề từ catalog thay vì tên file; `index` tự đặt lại theo bước đang mở. */
export default function RootLayout(): ReactElement {
  // HB-267: app luôn sáng ⇒ chữ thanh trạng thái tối, kể cả khi máy để chế độ tối.
  useDarkStatusBar();
  return (
    <Stack screenOptions={stackScreenOptions}>
      {Object.entries(ROUTE_TITLES).map(([name, title]) => (
        <Stack.Screen key={name} name={name} options={{ title }} />
      ))}
    </Stack>
  );
}
