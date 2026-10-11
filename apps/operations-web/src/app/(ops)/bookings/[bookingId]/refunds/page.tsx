import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../../config';
import { RefundScreen } from './refund-screen';
export const dynamic = 'force-dynamic';
export default async function RefundPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}): Promise<ReactElement> {
  const { bookingId } = await params;
  return (
    <Suspense fallback={null}>
      <RefundScreen
        key={bookingId}
        bookingId={bookingId}
        baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL}
      />
    </Suspense>
  );
}
