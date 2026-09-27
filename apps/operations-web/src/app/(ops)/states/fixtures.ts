import type { ScreenState } from '@pinehill/ui-web';

/** Slug dùng trên tuyến `?state=` để kiểm tra thủ công và chạy axe/e2e ở mọi trạng thái. */
export const STATE_SLUGS = [
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

export type StateSlug = (typeof STATE_SLUGS)[number];

export function isStateSlug(value: string): value is StateSlug {
  return STATE_SLUGS.some((slug) => slug === value);
}

const updatedAt = '2026-11-12T07:00:00.000Z';
const expiresAt = '2026-11-12T07:15:00.000Z';

/** Fixture của F0 — dữ liệu minh hoạ, không gọi API nghiệp vụ. */
const FIXTURES: Record<StateSlug, ScreenState> = {
  ready: { kind: 'ready' },
  loading: { kind: 'loading' },
  refreshing: { kind: 'refreshing', updatedAt, stale: false },
  empty: { kind: 'empty', reason: 'soldOut', canCreate: false },
  'validation-error': {
    kind: 'validationError',
    details: [{ field: 'adults', issue: 'OUT_OF_RANGE' }],
  },
  forbidden: { kind: 'forbidden' },
  conflict: {
    kind: 'conflict',
    currentVersion: '8',
    attemptedVersion: '7',
    onReload: () => undefined,
  },
  expired: { kind: 'expired', expiresAt, onReload: () => undefined },
  'unknown-outcome': {
    kind: 'unknownOutcome',
    referenceId: 'trace-f0-demo',
    onLookup: () => undefined,
  },
  success: { kind: 'success' },
};

export function createFixture(slug: StateSlug): ScreenState {
  return FIXTURES[slug];
}
