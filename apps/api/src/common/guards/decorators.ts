/**
 * Siêu dữ liệu route cho guard xác thực (HB-013) và lớp quyền (HB-014).
 * Khoá `pinehill.permission` do HB-014 đọc; guard HB-013 chỉ cần biết route có `@Public()` hay không.
 */
import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE_KEY = 'pinehill.public';
export const PASSWORD_CHANGE_ALLOWED_KEY = 'pinehill.passwordChangeAllowed';

/** Route công khai (login, refresh, health): guard xác thực bỏ qua. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE_KEY, true);

/**
 * Route vẫn cho qua khi tài khoản đang buộc đổi mật khẩu (QĐ-03 quyết định 8):
 * đổi mật khẩu và đăng xuất. Mọi route khác trả `E_AUTH_PASSWORD_CHANGE_REQUIRED`.
 */
export const AllowPasswordChange = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PASSWORD_CHANGE_ALLOWED_KEY, true);
