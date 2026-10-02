'use client';

import { useSearchParams } from 'next/navigation';
import type { ScreenState } from '@pinehill/ui-web';
import { demoState, isDemoStateSlug } from '../lib/demo-states';

/**
 * `?state=<slug>` ép màn hình hiện một trạng thái của hợp đồng §8.1 để kiểm thủ công và chạy axe/E2E.
 * Không có tham số (hoặc sai slug) → `undefined` để màn hình tải dữ liệu thật.
 */
export function useForcedState(): ScreenState | undefined {
  const params = useSearchParams();
  const requested = params.get('state');
  if (requested === null || !isDemoStateSlug(requested)) return undefined;
  return demoState(requested);
}
