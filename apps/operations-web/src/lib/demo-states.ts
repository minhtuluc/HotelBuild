import type { ScreenState } from '@pinehill/ui-web';

/**
 * Slug trạng thái dùng trên `?state=` để kiểm thủ công và chạy axe/E2E ở mọi trạng thái của hợp đồng
 * §8.1 (giống bộ khung F0). Giữ nguyên danh sách với `app/(ops)/states/fixtures.ts` để hai nơi không lệch.
 */
export const DEMO_STATES = [
  'ready',
  'loading',
  'refreshing',
  'empty',
  'validation-error',
  'forbidden',
  'conflict',
  'expired',
  'unknown-outcome',
  'success',
] as const;

export type DemoStateSlug = (typeof DEMO_STATES)[number];

export function isDemoStateSlug(value: string): value is DemoStateSlug {
  return DEMO_STATES.some((slug) => slug === value);
}

const updatedAt = '2026-11-12T07:00:00.000Z';
const expiresAt = '2026-11-12T07:15:00.000Z';
const noop = (): void => undefined;

/** Fixture minh hoạ cho từng trạng thái — dữ liệu giả, không gọi API. */
const FIXTURES: Readonly<Record<DemoStateSlug, ScreenState>> = {
  ready: { kind: 'ready' },
  loading: { kind: 'loading' },
  refreshing: { kind: 'refreshing', updatedAt, stale: false },
  empty: { kind: 'empty', reason: 'noData', canCreate: false },
  'validation-error': {
    kind: 'validationError',
    details: [{ field: 'overbookLimitPct', issue: 'OUT_OF_RANGE' }],
  },
  forbidden: { kind: 'forbidden' },
  conflict: {
    kind: 'conflict',
    currentVersion: '8',
    attemptedVersion: '7',
    onReload: noop,
  },
  expired: { kind: 'expired', expiresAt, onReload: noop },
  'unknown-outcome': {
    kind: 'unknownOutcome',
    referenceId: 'trace-demo-f2',
    onLookup: noop,
  },
  success: { kind: 'success' },
};

export function demoState(slug: DemoStateSlug): ScreenState {
  return FIXTURES[slug];
}
