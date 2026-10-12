import { useLocalSearchParams, Stack } from 'expo-router';
import type { ReactElement } from 'react';
import { PaymentScreen } from '../../src/payment/screen';
export default function PaymentRoute(): ReactElement {
  const params = useLocalSearchParams<{ bookingId?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Thanh toán tiền cọc' }} />
      <PaymentScreen bookingId={typeof params.bookingId === 'string' ? params.bookingId : ''} />
    </>
  );
}
