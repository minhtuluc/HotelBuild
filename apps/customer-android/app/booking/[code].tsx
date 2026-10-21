/**
 * SCR-80 (HB-113) — chi tiết đơn của tôi trên Android (đúng deep link `booking://<code>`).
 *
 * Đọc qua `GET /bookings?q=<mã>` bằng client của phiên; **offline** thì hiện **bản đã tải** kèm nhãn "có
 * thể đã cũ". Hợp đồng chưa có tuyến PriceSnapshot/Payment cho chi tiết nên màn hình để khung chờ đúng yêu
 * cầu thiết kế §8.1, không bịa số; huỷ/đổi ngày mở sang SCR-81/82 (HB-114).
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { color, radius, space, touchTargetDp, typography } from '@pinehill/ui-native';
import { createBookingApi } from '@pinehill/api-client';
import type { BookingSummary } from '@pinehill/contracts';
import { createSession } from '../../src/session-factory';
import { secureStorage } from '../../src/storage.native';
import { netInfoSource } from '../../src/netinfo.native';
import { t } from '../../src/strings';
import { formatVnd } from '../../src/search';
import {
  ORDER_STATUS_KEYS,
  balanceRows,
  bookingOf,
  loadOrderDetail,
  stayOf,
  type OrderDetailOutcome,
} from '../../src/orders';
import { OrderNotices } from '../../src/order-view';

function money(amount: number): string {
  return t('orders.money', { amount: formatVnd(amount) });
}

function DetailBody({ booking }: { booking: BookingSummary }): ReactElement {
  const status = t(ORDER_STATUS_KEYS[booking.status]);
  const stay = stayOf(booking);
  return (
    <>
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {t('orders.detail.code', { code: booking.code })}
      </Text>
      <Text style={{ color: color.text }} data-testid="order-status">
        {t('orders.detail.status', { status })}
      </Text>
      <Text style={{ color: color.text }} data-testid="order-stay">
        {t('orders.detail.stay', { stay })}
      </Text>
      <Text style={{ color: color.text }} data-testid="order-total">
        {t('orders.detail.total', { amount: money(booking.totalAmount) })}
      </Text>
      {balanceRows(booking).map((row) => (
        <Text
          key={row.key}
          accessible
          style={{ color: color.textMuted }}
          accessibilityLabel={t(row.key === 'paid' ? 'orders.paid' : 'orders.balance', {
            amount: money(row.amount),
          })}
        >
          {t(row.key === 'paid' ? 'orders.paid' : 'orders.balance', { amount: money(row.amount) })}
        </Text>
      ))}
      <Text style={{ color: color.textMuted }} data-testid="order-snapshot-pending">
        {t('orders.detail.snapshotPending')}
      </Text>
      <Text style={{ color: color.textMuted }} data-testid="order-payments-pending">
        {t('orders.detail.paymentsPending')}
      </Text>
      <View style={{ flexDirection: 'row', gap: space.s2 }}>
        <Link
          href={{ pathname: '/booking/[code]/cancel', params: { code: booking.code } }}
          accessibilityLabel={t('booking.cancel.open')}
          style={{ color: color.primary, minHeight: touchTargetDp, padding: space.s3 }}
        >
          {t('booking.cancel.open')}
        </Link>
        <Link
          href={{ pathname: '/booking/[code]/reschedule', params: { code: booking.code } }}
          accessibilityLabel={t('booking.reschedule.open')}
          style={{ color: color.primary, minHeight: touchTargetDp, padding: space.s3 }}
        >
          {t('booking.reschedule.open')}
        </Link>
      </View>
    </>
  );
}

export default function BookingDetailScreen(): ReactElement {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' ? params.code : '';
  const session = useMemo(() => createSession(), []);
  const net = useMemo(() => netInfoSource(), []);
  const storage = useMemo(() => secureStorage(), []);
  const api = useMemo(
    () => ({
      list: (query: { q?: string; limit?: number }) =>
        createBookingApi(session.apiClient())
          .list(query)
          .then((response) => response.data),
    }),
    [session],
  );
  const [ready, setReady] = useState(false);
  const [outcome, setOutcome] = useState<OrderDetailOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void session.silentRefresh().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const load = useCallback(async (): Promise<void> => {
    if (code === '') return;
    setBusy(true);
    setOutcome(await loadOrderDetail({ api, net, storage, nowMs: Date.now() }, code));
    setBusy(false);
  }, [api, code, net, storage]);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [load, ready]);

  if (!ready || busy)
    return <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />;

  const booking = bookingOf(outcome);

  return (
    <ScrollView contentContainerStyle={{ gap: space.s3, padding: space.s4 }}>
      <Text
        accessibilityRole="header"
        style={{ color: color.text, fontSize: typography.h1.sp, fontWeight: '700' }}
      >
        {t('orders.detail.title')}
      </Text>
      {code === '' ? (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {t('orders.detail.notFound')}
        </Text>
      ) : null}
      <OrderNotices outcome={outcome} />
      {booking ? (
        <Link
          href={{ pathname: '/payment/[bookingId]', params: { bookingId: booking.id } }}
          accessibilityLabel={t('orders.detail.pay')}
          style={{ minHeight: touchTargetDp, color: color.primary, padding: space.s3 }}
        >
          {t('orders.detail.pay')}
        </Link>
      ) : null}
      {booking === null ? null : <DetailBody booking={booking} />}
      {booking === null ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('orders.detail.share')}
          onPress={() => {
            void Share.share({
              message: `${booking.code} · ${stayOf(booking)} · ${t('orders.detail.total', {
                amount: money(booking.totalAmount),
              })}`,
            });
          }}
          style={{
            alignItems: 'center',
            borderColor: color.border,
            borderRadius: radius.sm,
            borderWidth: 1,
            justifyContent: 'center',
            minHeight: touchTargetDp,
          }}
        >
          <Text style={{ color: color.primary }}>{t('orders.detail.share')}</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('orders.reload')}
        onPress={() => void load()}
        style={{
          alignItems: 'center',
          borderColor: color.border,
          borderRadius: radius.sm,
          borderWidth: 1,
          justifyContent: 'center',
          minHeight: touchTargetDp,
        }}
      >
        <Text style={{ color: color.primary }}>{t('orders.reload')}</Text>
      </Pressable>
    </ScrollView>
  );
}
