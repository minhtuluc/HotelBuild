import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { NativeAccessDeniedPanel } from '@pinehill/ui-native';
import { t } from '../src/demo';

/** Tuyến thiếu quyền riêng cho shell Android (F0-04). */
export default function AccessDeniedScreen(): ReactElement {
  return <NativeAccessDeniedPanel t={t} onBack={() => router.replace('/')} />;
}
