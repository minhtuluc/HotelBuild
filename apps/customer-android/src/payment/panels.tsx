import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { color, space, radius, touchTargetDp, formatDateTimeVn } from '@pinehill/ui-native';
import { formatVnd } from '../search';
import type { PaymentView } from './flow';
import { approvedAmount, safePaymentUrl } from './model';
import { Link } from 'expo-router';
export function PaymentButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: touchTargetDp,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: color.primary,
        padding: space.s3,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: color.primary }}>{label}</Text>
    </Pressable>
  );
}
export function PaymentSummary({ view }: { view: PaymentView }): ReactElement | null {
  const offer = view.offer;
  if (!offer) return null;
  const amount = approvedAmount(offer.booking, offer.balance);
  return (
    <View style={{ gap: space.s2 }}>
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        Đặt phòng {offer.booking.code}
      </Text>
      <Text style={{ color: color.text }}>
        Tổng tiền phòng: {formatVnd(offer.balance.totalAmount)} đ
      </Text>
      <Text style={{ color: color.text }}>Đã thu: {formatVnd(offer.balance.paidAmount)} đ</Text>
      <Text style={{ color: color.text }}>
        Còn nợ theo sổ cái: {formatVnd(offer.balance.balanceDue)} đ
      </Text>
      <Text style={{ color: color.text, fontWeight: '700' }}>
        Cọc cần trả theo máy chủ: {amount === null ? 'Chưa có dữ liệu' : formatVnd(amount) + ' đ'}
      </Text>
      <Text style={{ color: color.text }}>
        Trạng thái đặt phòng từ máy chủ: {offer.booking.status}
      </Text>
      {offer.booking.holdExpiresAt ? (
        <Text style={{ color: color.textMuted }}>
          Hạn giữ chỗ: {formatDateTimeVn(offer.booking.holdExpiresAt)}. Hạn giữ chỗ độc lập với giao
          dịch thanh toán.
        </Text>
      ) : null}
      {view.payment ? (
        <>
          <Text selectable style={{ color: color.text }}>
            Mã giao dịch: {view.payment.paymentId}
          </Text>
          <Text style={{ color: color.text }}>
            Trạng thái giao dịch từ máy chủ: {view.payment.status}
          </Text>
        </>
      ) : null}
      {view.checkedAt ? (
        <Text style={{ color: color.textMuted }}>
          Đã đọc máy chủ lúc {formatDateTimeVn(view.checkedAt)}
        </Text>
      ) : null}
    </View>
  );
}
export function PaymentMethods({
  method,
  onChange,
  disabled,
}: {
  method: 'VNPAY' | 'MOMO';
  onChange: (method: 'VNPAY' | 'MOMO') => void;
  disabled: boolean;
}): ReactElement {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Cổng thanh toán"
      style={{ gap: space.s2 }}
    >
      {(['VNPAY', 'MOMO'] as const).map((value) => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          accessibilityLabel={value === 'VNPAY' ? 'VNPay' : 'MoMo'}
          accessibilityState={{ checked: method === value, disabled }}
          disabled={disabled}
          onPress={() => onChange(value)}
          style={{
            minHeight: touchTargetDp,
            padding: space.s3,
            borderWidth: 1,
            borderRadius: radius.sm,
            borderColor: method === value ? color.primary : color.border,
          }}
        >
          <Text style={{ color: color.text }}>
            {method === value ? '● ' : '○ '}
            {value === 'VNPAY' ? 'VNPay' : 'MoMo'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

interface Actions {
  referenceId?: string | undefined;
  view: PaymentView;
  method: 'VNPAY' | 'MOMO';
  setMethod: (m: 'VNPAY' | 'MOMO') => void;
  prepare: () => void;
  confirm: () => void;
  open: (url: string) => void;
  check: () => void;
}
function CreationActions({
  view,
  method,
  setMethod,
  prepare,
  confirm,
}: Actions): ReactElement | null {
  if (view.phase === 'ready')
    return (
      <>
        <PaymentMethods method={method} onChange={setMethod} disabled={view.busy} />
        <PaymentButton
          label="Xem lại trước khi thanh toán"
          disabled={view.busy}
          onPress={prepare}
        />
      </>
    );
  if (view.phase !== 'confirm') return null;
  return (
    <>
      <Text style={{ color: color.text }}>
        Cổng đã chọn: {method === 'MOMO' ? 'MoMo' : 'VNPay'}. Thanh toán mở trình duyệt hệ thống;
        khi trở về sẽ đọc lại máy chủ.
      </Text>
      <PaymentButton
        label="Xác nhận và mở cổng thanh toán"
        disabled={view.busy}
        onPress={confirm}
      />
    </>
  );
}
function PendingActions({ view, open }: Actions): ReactElement | null {
  if (view.phase !== 'pending') return null;
  const url = view.fullPayment ? safePaymentUrl(view.fullPayment) : null;
  return url ? (
    <PaymentButton
      label="Mở lại cổng thanh toán cho giao dịch này"
      disabled={view.busy}
      onPress={() => open(url)}
    />
  ) : (
    <Text style={{ color: color.warning }}>
      Máy chủ chưa trả liên kết HTTPS an toàn. Hãy kiểm tra trạng thái giao dịch.
    </Text>
  );
}
export function PaymentActions(props: Actions): ReactElement {
  const denied = props.view.phase === 'expired' || props.view.phase === 'forbidden';
  return (
    <>
      {props.view.phase === 'unknown' && props.referenceId ? (
        <Text selectable style={{ color: color.text }}>
          Mã tham chiếu: {props.referenceId}
        </Text>
      ) : null}
      <CreationActions {...props} />
      <PendingActions {...props} />
      {denied ? (
        <Link href="/" accessibilityLabel="Về đăng nhập">
          Về đăng nhập
        </Link>
      ) : (
        <PaymentButton
          label="Kiểm tra lại từ máy chủ"
          disabled={props.view.busy}
          onPress={props.check}
        />
      )}
    </>
  );
}
