import type { ReactElement } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text } from 'react-native';
import { Link } from 'expo-router';
import { color, space, touchTargetDp } from '@pinehill/ui-native';
import { phaseMessages, paymentText as text } from './messages';
import { PaymentSummary, PaymentActions } from './panels';
import { usePayment } from './use-payment';
import { theme } from '../theme';
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
      style={theme.scroll}
      contentContainerStyle={theme.scrollContent}
    >
      <Text accessibilityRole="header" style={theme.title}>
        {text('title')}
      </Text>
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={theme.body}>
        {phaseMessages[view.phase]}
      </Text>
      {view.busy ? (
        <ActivityIndicator accessibilityLabel={text('reading')} color={color.primary} />
      ) : null}
      <PaymentSummary view={view} />
      {view.changed ? (
        <Text accessibilityRole="alert" style={theme.alertWarning}>
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
        <Text accessibilityRole="alert" style={theme.alertDanger}>
          {text('handoffFailed')}
        </Text>
      ) : null}
      <Link
        href="/(tabs)/bookings"
        accessibilityLabel={text('backToBookings')}
        style={{ color: color.primary, minHeight: touchTargetDp, paddingVertical: space.s3 }}
      >
        {text('backToBookings')}
      </Link>
    </ScrollView>
  );
}
