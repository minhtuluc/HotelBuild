/**
 * HB-278 — vai nút của app vận hành khớp operations web (DESIGN.md §Buttons): `primary` là mực in (hành
 * động chính back-office), `plain` là viền (hành động phụ), `danger` là viền đỏ. Không bấm được thì đổi nền,
 * không làm mờ cả nút. Style lấy từ `buttonStyle` dùng chung của `@pinehill/ui-native`.
 */
import { buttonStyle } from '@pinehill/ui-native';

export type ActionTone = 'primary' | 'plain' | 'danger';

const ROLE = { primary: 'primary', plain: 'outline', danger: 'danger' } as const;

export function actionButtonStyle(tone: ActionTone, disabled: boolean, pressed = false) {
  return buttonStyle({ role: ROLE[tone], disabled, pressed });
}
