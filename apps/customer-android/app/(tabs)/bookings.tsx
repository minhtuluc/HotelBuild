/**
 * SCR-79 (HB-113) — đơn của tôi trên Android.
 *
 * Danh sách đọc từ `GET /bookings` bằng client của phiên khách; **offline thì hiện bản đã tải gần nhất**
 * kèm nhãn "có thể đã cũ" (chỉ để đọc — mọi lệnh ghi vẫn cần mạng). Mọi nhãn ở `src/strings.ts`, mỗi dòng
 * là một khối `accessible` có nhãn ghép, nút/nhập liệu đều có nhãn trợ năng.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
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
  loadOrders,
  stayOf,
  type OrdersOutcome,
} from '../../src/orders';

const CELL = { color: color.text } as const;

function money(amount: number): string {
  return t('orders.money', { amount: formatVnd(amount) });
}

function OrderRow({
  booking,
  onOpen,
}: {
  booking: BookingSummary;
  onOpen: () => void;
}): ReactElement {
  const status = t(ORDER_STATUS_KEYS[booking.status]);
  const moneyLine = balanceRows(booking)
    .map((row) =>
      t(row.key === 'paid' ? 'orders.paid' : 'orders.balance', { amount: money(row.amount) }),
    )
    .join(' · ');
  return (
    <View
      accessible
      accessibilityLabel={`${booking.code}. ${status}. ${stayOf(booking)}. ${moneyLine}`}
      style={{
        borderColor: color.border,
        borderRadius: radius.sm,
        borderWidth: 1,
        gap: space.s1,
        padding: space.s3,
      }}
    >
      <Text style={{ color: color.text, fontWeight: '700' }}>{booking.code}</Text>
      <Text style={CELL}>{status}</Text>
      <Text style={{ color: color.textMuted }}>{stayOf(booking)}</Text>
      <Text style={{ color: color.textMuted }}>{moneyLine}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('orders.open')} ${booking.code}`}
        onPress={onOpen}
        style={{ minHeight: touchTargetDp, justifyContent: 'center' }}
      >
        <Text style={{ color: color.primary, fontWeight: '700' }}>{t('orders.open')}</Text>
      </Pressable>
    </View>
  );
}

function SearchBar({
  query,
  busy,
  onChange,
  onSearch,
}: {
  query: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSearch: () => void;
}): ReactElement {
  const button = {
    alignItems: 'center',
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: touchTargetDp,
  } as const;
  return (
    <View style={{ gap: space.s2 }}>
      <TextInput
        accessibilityLabel={t('orders.search')}
        value={query}
        onChangeText={onChange}
        placeholder={t('orders.search')}
        autoCapitalize="characters"
        style={{
          borderColor: color.border,
          borderRadius: radius.sm,
          borderWidth: 1,
          color: color.text,
          minHeight: touchTargetDp,
          paddingHorizontal: space.s3,
        }}
      />
      <View style={{ flexDirection: 'row', gap: space.s2 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('orders.search.run')}
          accessibilityState={{ busy }}
          disabled={busy}
          onPress={onSearch}
          style={{ ...button, backgroundColor: color.primary }}
        >
          <Text style={{ color: color.surface, fontWeight: '700' }}>{t('orders.search.run')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('orders.reload')}
          accessibilityState={{ busy }}
          disabled={busy}
          onPress={onSearch}
          style={{ ...button, borderColor: color.border, borderWidth: 1 }}
        >
          <Text style={{ color: color.primary }}>{t('orders.reload')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StaleNotice({
  outcome,
}: {
  outcome: Extract<OrdersOutcome, { kind: 'offline' }>;
}): ReactElement {
  const time =
    outcome.cachedAt === null ? t('orders.stale.unknown') : formatDateTimeVn(outcome.cachedAt);
  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ color: color.warning }}
      data-testid="orders-stale"
    >
      {outcome.cached.length === 0 ? t('guest.offline') : t('orders.stale', { time })}
    </Text>
  );
}

function OrdersNotice({
  outcome,
  busy,
}: {
  outcome: OrdersOutcome | null;
  busy: boolean;
}): ReactElement {
  return (
    <>
      {!busy ? null : (
        <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />
      )}
      {outcome === null || outcome.kind !== 'offline' ? null : <StaleNotice outcome={outcome} />}
      {outcome === null || outcome.kind !== 'failed' ? null : (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {t('orders.failed', { code: outcome.code ?? 'UNKNOWN' })}
        </Text>
      )}
      {outcome === null || outcome.kind !== 'empty' ? null : (
        <Text accessibilityRole="alert" style={{ color: color.textMuted }}>
          {t('orders.empty')}
        </Text>
      )}
    </>
  );
}

export default function BookingsScreen(): ReactElement {
  const router = useRouter();
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
  const [outcome, setOutcome] = useState<OrdersOutcome | null>(null);
  const [query, setQuery] = useState('');
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

  const load = useCallback(
    async (code = ''): Promise<void> => {
      setBusy(true);
      setOutcome(await loadOrders({ api, net, storage, nowMs: Date.now() }, { q: code }));
      setBusy(false);
    },
    [api, net, storage],
  );

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [load, ready]);

  if (!ready)
    return <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />;

  const bookings =
    outcome === null
      ? []
      : outcome.kind === 'ready'
        ? outcome.bookings
        : outcome.kind === 'offline'
          ? outcome.cached
          : [];

  return (
    <ScrollView contentContainerStyle={{ gap: space.s3, padding: space.s4 }}>
      <Text
        accessibilityRole="header"
        style={{ color: color.text, fontSize: typography.h1.sp, fontWeight: '700' }}
      >
        {t('orders.title')}
      </Text>

      <SearchBar query={query} busy={busy} onChange={setQuery} onSearch={() => void load(query)} />
      <OrdersNotice outcome={outcome} busy={busy} />

      {bookings.map((booking) => (
        <OrderRow
          key={booking.id}
          booking={booking}
          onOpen={() => {
            router.push({ pathname: '/booking/[code]', params: { code: booking.code } });
          }}
        />
      ))}
    </ScrollView>
  );
}
