import { Suspense, type ReactElement } from 'react';
import { frontDeskContact } from '../../../../config';
import { accountText } from '../messages';
import { LoginScreen } from '../login-screen';

/** Tuyến động: thông tin liên hệ lễ tân đọc từ cấu hình ở thời điểm gọi (kiến trúc §7.5). */
export const dynamic = 'force-dynamic';

export const metadata = { title: accountText('loginTitle') } as const;

export default function Page(): ReactElement {
  return (
    <Suspense fallback={null}>
      <LoginScreen contact={frontDeskContact()} />
    </Suspense>
  );
}
