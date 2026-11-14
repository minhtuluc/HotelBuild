import { Suspense, type ReactElement } from 'react';
import type { Metadata } from 'next';
import { frontDeskContact } from '../../../../config';
import { serverTranslators } from '../../../../i18n/server';
import { LoginScreen } from '../login-screen';

/** Tuyến động: thông tin liên hệ lễ tân đọc từ cấu hình ở thời điểm gọi (kiến trúc §7.5). */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverTranslators()).account('loginTitle') };
}

export default function Page(): ReactElement {
  return (
    <Suspense fallback={null}>
      <LoginScreen contact={frontDeskContact()} />
    </Suspense>
  );
}
