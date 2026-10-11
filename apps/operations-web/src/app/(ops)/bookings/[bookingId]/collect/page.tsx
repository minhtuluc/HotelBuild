import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../../config';
import { CollectScreen } from './collect-screen';

/** SCR-37 — thu cọc / thu số dư tại quầy (F5). */
export const dynamic = 'force-dynamic';

export default async function CollectPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}): Promise<ReactElement> {
  const { bookingId } = await params;
  return (
    <Suspense fallback={null}>
      <CollectScreen key={bookingId} baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
