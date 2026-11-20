import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { color, space, radius, touchTargetDp } from '@pinehill/ui-native';
import { formatVnd } from '../search';
import type { PaymentView } from './flow';
import { approvedAmount, safePaymentUrl } from './model';
import { Link } from 'expo-router';
import { paymentText as text } from './messages';
import { theme } from '../theme';
import { dateTimeLabel } from '../i18n/format';

const money = (amount: number): string => text('money', { amount: formatVnd(amount) });

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
      style={[
        theme.buttonSecondary,
        {
          borderColor: color.primary,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={theme.buttonPlainText}>{label}</Text>
    </Pressable>
  );
}
export function PaymentSummary({ view }: { view: PaymentView }): ReactElement | null {
  const offer = view.offer;
  if (!offer) return null;
  const amount = approvedAmount(offer.booking, offer.balance);
  return (
    <View style={theme.card}>
      <Text accessibilityRole="header" style={theme.sectionTitle}>
        {text('booking', { code: offer.booking.code })}
      </Text>
      <Text style={[theme.body, theme.tabular]}>
        {text('total', { amount: money(offer.balance.totalAmount) })}
      </Text>
      <Text style={[theme.body, theme.tabular]}>
        {text('paid', { amount: money(offer.balance.paidAmount) })}
      </Text>
      <Text style={[theme.body, theme.tabular]}>
        {text('balance', { amount: money(offer.balance.balanceDue) })}
      </Text>
      <Text style={[theme.moneyInline, theme.tabular]}>
        {text('deposit', {
          amount: amount === null ? text('unavailableAmount') : money(amount),
        })}
      </Text>
      <View style={theme.divider} />
      <Text style={theme.body}>{text('bookingStatus', { status: offer.booking.status })}</Text>
      {offer.booking.holdExpiresAt ? (
        <Text style={theme.muted}>
          {text('holdExpiry', { time: dateTimeLabel(offer.booking.holdExpiresAt) })}
        </Text>
      ) : null}
      {view.payment ? (
        <>
          <Text selectable style={theme.body}>
            {text('transaction', { id: view.payment.paymentId })}
          </Text>
          <Text style={theme.body}>{text('paymentStatus', { status: view.payment.status })}</Text>
        </>
      ) : null}
      {view.checkedAt ? (
        <Text style={theme.muted}>
          {text('checkedAt', { time: dateTimeLabel(view.checkedAt) })}
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
      accessibilityLabel={text('provider')}
      style={{ gap: space.s2 }}
    >
      {(['VNPAY', 'MOMO'] as const).map((value) => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          accessibilityLabel={value === 'VNPAY' ? text('providerVnpay') : text('providerMomo')}
          accessibilityState={{ checked: method === value, disabled }}
          disabled={disabled}
          onPress={() => onChange(value)}
          style={{
            minHeight: touchTargetDp,
            padding: space.s3,
            backgroundColor: color.surface,
            borderWidth: method === value ? 2 : 1,
            borderRadius: radius.md,
            borderColor: method === value ? color.primary : color.border,
          }}
        >
          <Text style={theme.body}>
            {method === value ? '● ' : '○ '}
            {value === 'VNPAY' ? text('providerVnpay') : text('providerMomo')}
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
        <PaymentButton label={text('prepare')} disabled={view.busy} onPress={prepare} />
      </>
    );
  if (view.phase !== 'confirm') return null;
  return (
    <>
      <Text style={theme.body}>
        {text('confirmInfo', {
          provider: method === 'MOMO' ? text('providerMomo') : text('providerVnpay'),
        })}
      </Text>
      <PaymentButton label={text('confirm')} disabled={view.busy} onPress={confirm} />
    </>
  );
}
function PendingActions({ view, open }: Actions): ReactElement | null {
  if (view.phase !== 'pending') return null;
  const url = view.fullPayment ? safePaymentUrl(view.fullPayment) : null;
  return url ? (
    <PaymentButton label={text('reopen')} disabled={view.busy} onPress={() => open(url)} />
  ) : (
    <Text style={theme.alertWarning}>{text('unsafeUrl')}</Text>
  );
}
export function PaymentActions(props: Actions): ReactElement {
  const denied = props.view.phase === 'expired' || props.view.phase === 'forbidden';
  return (
    <>
      {props.view.phase === 'unknown' && props.referenceId ? (
        <Text selectable style={theme.body}>
          {text('reference', { id: props.referenceId })}
        </Text>
      ) : null}
      <CreationActions {...props} />
      <PendingActions {...props} />
      {denied ? (
        <Link href="/" accessibilityLabel={text('login')}>
          {text('login')}
        </Link>
      ) : (
        <PaymentButton label={text('check')} disabled={props.view.busy} onPress={props.check} />
      )}
    </>
  );
}
