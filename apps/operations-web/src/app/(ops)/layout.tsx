import type { ReactElement, ReactNode } from 'react';
import { StaffSessionBoundary } from '../../session/staff-session';

/**
 * Khu vực nhân viên (SCR-14): chặn khi chưa đăng nhập → `/login?next=…`, buộc đổi mật khẩu tạm, bắt chọn cơ
 * sở đang làm việc, về đăng nhập khi phiên hết hạn hoặc nhàn rỗi 15 phút. Máy chủ vẫn là nơi quyết định quyền.
 */
export default function OpsLayout({ children }: { children: ReactNode }): ReactElement {
  return <StaffSessionBoundary stage="app">{children}</StaffSessionBoundary>;
}
