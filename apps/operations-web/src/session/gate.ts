/**
 * Cổng của khu vực nhân viên (SCR-14): từ hồ sơ `GET /auth/me` + danh sách cơ sở + lựa chọn đã lưu, quyết
 * định đi tiếp, chuyển hướng hay dừng. Hàm thuần để kiểm bằng vitest; không có luật phân quyền — danh sách
 * cơ sở được cấp là `propertyScope` do máy chủ trả (ADR-018).
 */
import type { UserMe } from '@pinehill/contracts';
import { resolveWorkingProperty } from './working-property';

export interface PropertyOption {
  readonly id: string;
  readonly name: string;
}

export type GateStage = 'app' | 'change-password' | 'select-property';

export type GateOutcome =
  | { readonly kind: 'redirect'; readonly to: 'login' | 'change-password' | 'select-property' }
  | { readonly kind: 'ready'; readonly propertyId: string | null }
  | { readonly kind: 'none' };

/**
 * Cơ sở người dùng được chọn: OWNER thấy mọi cơ sở máy chủ liệt kê; vai trò khác chỉ phần giao với
 * `propertyScope`. Chưa có danh sách (không cần tải, hoặc tải thất bại) thì dùng thẳng `propertyScope`
 * làm cả mã lẫn tên.
 */
export function grantedProperties(
  me: Pick<UserMe, 'role' | 'propertyScope'>,
  properties: readonly PropertyOption[] | null,
): readonly PropertyOption[] {
  if (properties === null) return me.propertyScope.map((id) => ({ id, name: id }));
  return me.role === 'OWNER'
    ? properties
    : properties.filter((property) => me.propertyScope.includes(property.id));
}

export function decideGate(input: {
  stage: GateStage;
  me: UserMe | null;
  properties: readonly PropertyOption[] | null;
  stored: string | null;
}): GateOutcome {
  const { stage, me, properties, stored } = input;
  if (me === null) return { kind: 'redirect', to: 'login' };
  if (stage === 'change-password') return { kind: 'ready', propertyId: null };
  if (me.mustChangePassword) return { kind: 'redirect', to: 'change-password' };
  const choices = grantedProperties(me, properties).map((property) => property.id);
  const choice = resolveWorkingProperty({ choices, stored });
  if (stage === 'select-property') return { kind: 'ready', propertyId: null };
  if (choice.kind === 'none') return { kind: 'none' };
  if (choice.kind === 'choose') return { kind: 'redirect', to: 'select-property' };
  return { kind: 'ready', propertyId: choice.propertyId };
}
