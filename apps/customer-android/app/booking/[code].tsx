/**
 * SCR-80 (HB-113) — chi tiết đơn của tôi trên Android (đúng deep link `booking://<code>`).
 *
 * Đọc qua `GET /bookings?q=<mã>` bằng client của phiên; **offline** thì hiện **bản đã tải** kèm nhãn "có
 * thể đã cũ". Hợp đồng chưa có tuyến PriceSnapshot/Payment cho chi tiết nên màn hình để khung chờ đúng yêu
 * cầu thiết kế §8.1, không bịa số; huỷ/đổi ngày thuộc HB-114.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  color,
  radius,
  space,
  touchTargetDp,
  typography,
  formatDateTimeVn,
} from '@pinehill/ui-native';
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
  loadOrderDetail,
  stayOf,
  type OrderDetailOutcome,
} from '../../src/orders';

function bookingOf(outcome: OrderDetailOutcome | null): BookingSummary | null {
  if (outcome === null) return null;
  if (outcome.kind === 'ready') return outcome.booking;
  if (outcome.kind === 'offline') return outcome.booking;
  return null;
}

function money(amount: number): string {
  return t('orders.money', { amount: formatVnd(amount) });
}

interface Notice {
  readonly testId: string;
  readonly text: string;
  readonly tone: 'warning' | 'danger';
}

/** Thông báo của màn chi tiết: cũ khi offline, không thấy trong bản đã tải, hoặc lỗi theo mã. */
function noticesOf(outcome: OrderDetailOutcome | null): readonly Notice[] {
  if (outcome === null) return [];
  if (outcome.kind === 'failed')
    return [
      {
        testId: 'order-failed',
        text: t('orders.failed', { code: outcome.code ?? 'UNKNOWN' }),
        tone: 'danger',
      },
    ];
  if (outcome.kind === 'notFound')
    return [{ testId: 'order-not-found', text: t('orders.detail.notFound'), tone: 'danger' }];
  if (outcome.kind !== 'offline') return [];
  const time =
    outcome.cachedAt === null ? t('orders.stale.unknown') : formatDateTimeVn(outcome.cachedAt);
  const stale: Notice = {
    testId: 'order-stale',
    text: t('orders.stale', { time }),
    tone: 'warning',
  };
  if (outcome.booking !== null) return [stale];
  return [
    stale,
    { testId: 'order-not-cached', text: t('orders.detail.notCached'), tone: 'danger' },
  ];
}

function DetailNotice({ outcome }: { outcome: OrderDetailOutcome | null }): ReactElement {
  return (
    <>
      {noticesOf(outcome).map((notice) => (
        <Text
          key={notice.testId}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          data-testid={notice.testId}
          style={{ color: notice.tone === 'warning' ? color.warning : color.danger }}
        >
          {notice.text}
        </Text>
      ))}
    </>
  );
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
      <Text style={{ color: color.textMuted }}>{t('orders.detail.actionsPending')}</Text>
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
      <DetailNotice outcome={outcome} />
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
