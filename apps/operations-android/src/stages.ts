/**
 * Các bước của luồng chính (app/index.tsx) và tiêu đề header — phần thuần, kiểm được trên Node.
 * HB-252: header không còn hiện tên file route (`index`), nút Back của Android không thoát app giữa chừng.
 */
import { f6Text } from './features/f6-overbooking/messages';
import { t } from './strings';

export const STAGES = [
  'boot',
  'login',
  'changePassword',
  'pinSetup',
  'selectProperty',
  'home',
  'housekeeping',
  'lookup',
  'arrivals',
  'walkIn',
  'departures',
  'cash',
] as const;

export type Stage = (typeof STAGES)[number];

const STAGE_TITLES: Readonly<Record<Stage, string>> = {
  boot: t('screen.home'),
  login: t('screen.login'),
  changePassword: t('changePassword.title'),
  pinSetup: t('pin.setup.title'),
  selectProperty: t('screen.property'),
  home: t('screen.home'),
  housekeeping: t('screen.housekeeping'),
  lookup: t('screen.lookup'),
  arrivals: t('screen.arrivals'),
  walkIn: t('screen.walkIn'),
  departures: t('screen.departures'),
  cash: t('screen.cash'),
};

export function stageTitle(stage: Stage): string {
  return STAGE_TITLES[stage];
}

/** Tiêu đề header của từng file route (đường dẫn trong `app/`, bỏ đuôi `.tsx`). */
export const ROUTE_TITLES: Readonly<Record<string, string>> = {
  index: t('screen.home'),
  home: t('screen.home'),
  login: t('screen.login'),
  'change-password': t('changePassword.title'),
  'pin-setup': t('pin.setup.title'),
  'select-property': t('screen.property'),
  'access-denied': t('access.denied.title'),
  '+not-found': t('screen.notFound'),
  '(f6)/alerts': f6Text('alertsTitle'),
  '(f6)/relocation': f6Text('moveTitle'),
};

export type BackStep = 'closeNoShow' | 'closeCollect' | 'closeWalkIn' | 'home' | 'default';

export interface BackState {
  stage: Stage;
  noShow: boolean;
  collecting: boolean;
  walkInFromArrivals: boolean;
}

const TOOL_STAGES: ReadonlySet<Stage> = new Set([
  'housekeeping',
  'lookup',
  'arrivals',
  'walkIn',
  'departures',
  'cash',
]);

/** Nút Back cứng: đóng màn con đang mở trước, rồi đưa công cụ về màn chính; còn lại để Android tự xử. */
export function backStep(state: BackState): BackStep {
  if (state.noShow) return 'closeNoShow';
  if (state.collecting) return 'closeCollect';
  if (state.walkInFromArrivals) return 'closeWalkIn';
  return TOOL_STAGES.has(state.stage) ? 'home' : 'default';
}
