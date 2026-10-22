import { Suspense, type ReactElement } from 'react';
import { LoginForm } from './login-form';

/** SCR-14 — đăng nhập nội bộ. Tuyến động: `next`/`reason` đọc từ URL ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function LoginPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
