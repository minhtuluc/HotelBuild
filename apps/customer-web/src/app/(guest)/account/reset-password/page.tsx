import { Suspense, type ReactElement } from 'react';
import { frontDeskContact } from '../../../../config';
import { accountText } from '../messages';
import { ResetScreen } from '../reset-screen';

/** Tuyến động: thông tin liên hệ lễ tân đọc từ cấu hình ở thời điểm gọi (kiến trúc §7.5). */
export const dynamic = 'force-dynamic';

/** Token đặt lại không được rò qua tiêu đề Referer sang trang khác. */
export const metadata = { title: accountText('resetTitle'), referrer: 'no-referrer' } as const;

export default function Page(): ReactElement {
  return (
    <Suspense fallback={null}>
      <ResetScreen contact={frontDeskContact()} />
    </Suspense>
  );
}
