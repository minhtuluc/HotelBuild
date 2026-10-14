import { useLocalSearchParams, Stack } from 'expo-router';
import type { ReactElement } from 'react';
import { PaymentScreen } from '../../src/payment/screen';
import { paymentText } from '../../src/payment/messages';
export default function PaymentRoute(): ReactElement {
  const params = useLocalSearchParams<{ bookingId?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: paymentText('title') }} />
      <PaymentScreen bookingId={typeof params.bookingId === 'string' ? params.bookingId : ''} />
    </>
  );
}
