import { Suspense, type ReactElement } from 'react';
import { StaffSessionBoundary } from '../../../session/staff-session';
import { ChangePasswordForm } from './change-password-form';

/** SCR-14 — đổi mật khẩu bắt buộc (QĐ-03 quyết định 8). Cần phiên; chưa đăng nhập thì về `/login`. */
export const dynamic = 'force-dynamic';

export default function ChangePasswordPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <StaffSessionBoundary stage="change-password">
        <ChangePasswordForm />
      </StaffSessionBoundary>
    </Suspense>
  );
}
