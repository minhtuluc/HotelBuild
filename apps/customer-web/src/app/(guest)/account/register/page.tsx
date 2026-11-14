import { Suspense, type ReactElement } from 'react';
import { frontDeskContact } from '../../../../config';
import { serverTranslators } from '../../../../i18n/server';
import { RegisterScreen } from '../register-screen';

/** Tuyến động: thông tin liên hệ lễ tân đọc từ cấu hình ở thời điểm gọi (kiến trúc §7.5). */
export const dynamic = 'force-dynamic';

export const metadata = { title: serverTranslators().account('registerTitle') } as const;

export default function Page(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RegisterScreen contact={frontDeskContact()} />
    </Suspense>
  );
}
