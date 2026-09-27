import { Stack, type ErrorBoundaryProps } from 'expo-router';
import type { ReactElement } from 'react';
import { NativeErrorPanel } from '@pinehill/ui-native';
import { t } from '../src/demo';

/** Biên lỗi của router (F0-04): không hiện stack trace, chỉ câu chữ an toàn. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps): ReactElement {
  return <NativeErrorPanel t={t} onRetry={() => void retry()} />;
}

export default function RootLayout(): ReactElement {
  return <Stack screenOptions={{ headerTitleAlign: 'center' }} />;
}
