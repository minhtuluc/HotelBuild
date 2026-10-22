import { Suspense, type ReactElement } from 'react';
import { frontDeskContact } from '../../../../config';
import { accountText } from '../messages';
import { ForgotScreen } from '../forgot-screen';

/** Tuyến động: thông tin liên hệ lễ tân đọc từ cấu hình ở thời điểm gọi (kiến trúc §7.5). */
export const dynamic = 'force-dynamic';

export const metadata = { title: accountText('forgotTitle') } as const;

export default function Page(): ReactElement {
  return (
    <Suspense fallback={null}>
      <ForgotScreen contact={frontDeskContact()} />
    </Suspense>
  );
}
