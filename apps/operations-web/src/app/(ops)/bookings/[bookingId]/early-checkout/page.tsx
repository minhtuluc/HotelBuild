import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../../config';
import { EarlyCheckoutScreen } from './early-checkout-screen';

/** SCR-69 — Xử lý trả phòng sớm (HB-111). */
export const dynamic = 'force-dynamic';

export default async function EarlyCheckoutPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}): Promise<ReactElement> {
  const { bookingId } = await params;
  return (
    <Suspense fallback={null}>
      <EarlyCheckoutScreen key={bookingId} baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
