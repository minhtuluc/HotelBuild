import type { ScreenState } from '@pinehill/ui-web';
import {
  DEMO_STATES,
  demoState,
  isDemoStateSlug,
  type DemoStateSlug,
} from '../../../lib/demo-states';

/**
 * Tuyến `?state=<slug>` của khung F0. Danh sách slug và fixture dùng chung với các màn nghiệp vụ
 * (`lib/demo-states.ts`) để hai nơi không lệch nhau.
 */
export const STATE_SLUGS = DEMO_STATES;

export type StateSlug = DemoStateSlug;

export const isStateSlug = isDemoStateSlug;

export function createFixture(slug: StateSlug): ScreenState {
  return demoState(slug);
}
