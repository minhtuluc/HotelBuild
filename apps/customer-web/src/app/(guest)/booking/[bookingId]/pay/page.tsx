import { Suspense } from 'react';
import { sessionConfig } from '../../../../../config/session';
import { PaymentScreen } from './payment-screen';
export const dynamic = 'force-dynamic';
export default function PaymentPage() {
  const origin = new URL(sessionConfig().baseUrl).origin;
  // Only the already-configured loopback HTTP fixture may replace a TLS PSP for local UI evidence.
  const fixtureOrigin = new URL(origin).hostname === '127.0.0.1' ? origin : undefined;
  return (
    <Suspense fallback={null}>
      <PaymentScreen fixtureOrigin={fixtureOrigin} />
    </Suspense>
  );
}
