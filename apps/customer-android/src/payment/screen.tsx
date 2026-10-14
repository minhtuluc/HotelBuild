import type { ReactElement } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text } from 'react-native';
import { Link } from 'expo-router';
import { color, space, typography } from '@pinehill/ui-native';
import { phaseMessages, paymentText as text } from './messages';
import { PaymentSummary, PaymentActions } from './panels';
import { usePayment } from './use-payment';
export function PaymentScreen({ bookingId }: { bookingId: string }): ReactElement {
  const runtime = usePayment(bookingId);
  const { view, flow, method, setMethod, handoffFailed, setHandoffFailed, retry } = runtime;
  const open = async (url: string) => {
    try {
      await Linking.openURL(url);
      setHandoffFailed(false);
    } catch {
      setHandoffFailed(true);
    }
  };
  const confirm = async () => {
    const current = flow.current;
    const url = await current?.confirm();
    if (url && current === flow.current) await open(url);
  };
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: space.s3, padding: space.s4 }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}
      >
        {text('title')}
      </Text>
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{ color: color.text }}
      >
        {phaseMessages[view.phase]}
      </Text>
      {view.busy ? (
        <ActivityIndicator accessibilityLabel={text('reading')} color={color.primary} />
      ) : null}
      <PaymentSummary view={view} />
      {view.changed ? (
        <Text accessibilityRole="alert" style={{ color: color.warning }}>
          {text('changed')}
        </Text>
      ) : null}
      <PaymentActions
        referenceId={flow.current?.referenceId}
        view={view}
        method={method}
        setMethod={setMethod}
        prepare={() => void flow.current?.prepare(method)}
        confirm={() => void confirm()}
        open={(url) => void open(url)}
        check={() => void retry.current?.()}
      />
      {handoffFailed ? (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {text('handoffFailed')}
        </Text>
      ) : null}
      <Link href="/(tabs)/bookings" accessibilityLabel={text('backToBookings')}>
        {text('backToBookings')}
      </Link>
    </ScrollView>
  );
}
