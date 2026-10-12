import type { ReactElement } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text } from 'react-native';
import { Link } from 'expo-router';
import { color, space, typography } from '@pinehill/ui-native';
import { phaseMessages } from './messages';
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
        Thanh toán tiền cọc
      </Text>
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{ color: color.text }}
      >
        {phaseMessages[view.phase]}
      </Text>
      {view.busy ? (
        <ActivityIndicator accessibilityLabel="Đang đọc máy chủ" color={color.primary} />
      ) : null}
      <PaymentSummary view={view} />
      {view.changed ? (
        <Text accessibilityRole="alert" style={{ color: color.warning }}>
          Số tiền hoặc đặt phòng đã đổi. Đọc dữ liệu mới rồi xác nhận lại.
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
          Không mở được trình duyệt. Giao dịch vẫn được giữ; kiểm tra lại hoặc mở lại cùng giao
          dịch.
        </Text>
      ) : null}
      <Link href="/(tabs)/bookings" accessibilityLabel="Về đơn của tôi">
        Về đơn của tôi
      </Link>
    </ScrollView>
  );
}
