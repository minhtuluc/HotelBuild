/**
 * SCR-74 + SCR-75 (HB-086) — chi tiết phòng & gói giá trên Android.
 *
 * Màn chỉ hiển thị kết quả của `src/room-detail.ts`: lấy gói giá công khai, báo giá theo gói đang chọn,
 * in **nguyên văn** giá từng đêm/tổng hợp máy chủ trả (BR-RATE-17) và đặt **điều khoản huỷ trước** bước
 * xác nhận (HB-087). Không access token; mọi nhãn ở `src/strings.ts`; phần tử tương tác đều có nhãn.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  color,
  radius,
  space,
  touchTargetDp,
  typography,
  formatDateTimeVn,
} from '@pinehill/ui-native';
import type { Quote, RatePlanCode, RatePlanPublic } from '@pinehill/contracts';
import { createAppApiClient } from '../../src/api';
import { createPublicJourneyApi } from '../../src/public-client';
import { netInfoSource } from '../../src/netinfo.native';
import { t } from '../../src/strings';
import { formatVnd } from '../../src/search';
import {
  criteriaFromParams,
  detailView,
  loadPlans,
  loadQuote,
  nightsTable,
  planCodeOf,
  planTerms,
  totalsRows,
  type DetailView,
  type PlansOutcome,
  type QuoteOutcome,
  type RoomCriteria,
} from '../../src/room-detail';

const CELL = { flex: 1, color: color.text } as const;

function money(amount: number): string {
  return t('room.money', { amount: formatVnd(amount) });
}

function NightsTable({ quote }: { quote: Quote }): ReactElement {
  return (
    <View style={{ gap: space.s2 }}>
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {t('room.nights.title')}
      </Text>
      <Text style={{ color: color.textMuted }}>{t('room.nights.note')}</Text>
      {nightsTable(quote).map((night) => (
        <View
          key={night.date}
          accessible
          accessibilityLabel={`${night.date}. ${t('room.col.basePrice')} ${money(night.basePrice)}. ${t('room.col.nightlyPrice')} ${money(night.nightlyPrice)}${night.clamped ? `. ${t('room.flag.clamped')}` : ''}`}
          style={{
            borderColor: color.border,
            borderRadius: radius.sm,
            borderWidth: 1,
            gap: space.s1,
            padding: space.s2,
          }}
        >
          <Text style={CELL}>{night.date}</Text>
          <Text style={{ color: color.textMuted }}>
            {t('room.col.basePrice')}: {money(night.basePrice)}
          </Text>
          <Text style={{ color: color.text, fontWeight: '700' }}>
            {t('room.col.nightlyPrice')}: {money(night.nightlyPrice)}
          </Text>
          {!night.clamped ? null : (
            <Text style={{ color: color.warning }}>{t('room.flag.clamped')}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

function Totals({ quote }: { quote: Quote }): ReactElement {
  const labels = {
    subtotal: t('room.summary.subtotal'),
    discount: t('room.summary.discount'),
    total: t('room.summary.total'),
    deposit: t('room.summary.deposit', { percent: quote.depositPercent }),
  } as const;
  return (
    <View style={{ gap: space.s1 }}>
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {t('room.summary.title')}
      </Text>
      {totalsRows(quote).map((row) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={`${labels[row.key]}: ${money(row.amount)}`}
          style={{ flexDirection: 'row' }}
        >
          <Text style={{ color: color.textMuted, flex: 1 }}>{labels[row.key]}</Text>
          <Text style={CELL}>{money(row.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

function Terms({ plan }: { plan: RatePlanPublic }): ReactElement {
  const terms = planTerms(plan);
  return (
    <View style={{ gap: space.s1 }} accessible>
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {t('room.terms.title')}
      </Text>
      <Text style={{ color: color.text }}>
        {t('room.terms.deposit', { percent: terms.depositPercent })}
      </Text>
      <Text style={{ color: color.textMuted }}>
        {terms.freeCancelHours === null
          ? t('room.terms.freeCancelUnknown')
          : t('room.terms.freeCancel', { hours: terms.freeCancelHours })}
      </Text>
      <Text style={{ color: color.textMuted }}>
        {t('room.terms.nights', { min: terms.minNights, max: terms.maxNights })}
      </Text>
    </View>
  );
}

function TextAction({ label, onPress }: { label: string; onPress: () => void }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: touchTargetDp, justifyContent: 'center' }}
    >
      <Text style={{ color: color.primary }}>{label}</Text>
    </Pressable>
  );
}

/** Thông báo trạng thái thay thế nội dung: offline, lỗi theo mã, hoặc cơ sở chưa mở bán. */
function Problem({
  kind,
  code,
  onRetry,
}: {
  kind: 'offline' | 'failed' | 'empty';
  code: string | null;
  onRetry: () => void;
}): ReactElement {
  const text =
    kind === 'offline'
      ? t('guest.offline')
      : kind === 'empty'
        ? t('room.empty')
        : t('room.failed', { code: code ?? 'UNKNOWN' });
  return (
    <View style={{ gap: space.s2 }}>
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{ color: kind === 'empty' ? color.textMuted : color.danger }}
      >
        {text}
      </Text>
      {kind === 'empty' ? null : <TextAction label={t('room.retry')} onPress={onRetry} />}
    </View>
  );
}

function PlanPicker({
  plans,
  selected,
  busy,
  onSelect,
}: {
  plans: readonly RatePlanPublic[];
  selected: RatePlanCode | null;
  busy: boolean;
  onSelect: (code: string) => void;
}): ReactElement {
  return (
    <View style={{ gap: space.s2 }}>
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {t('room.plan')}
      </Text>
      {plans.map((plan) => (
        <Pressable
          key={plan.code}
          accessibilityRole="button"
          accessibilityLabel={`${t('room.plan')} ${plan.name}`}
          accessibilityState={{ selected: selected === plan.code, busy }}
          disabled={busy}
          onPress={() => {
            onSelect(plan.code);
          }}
          style={{
            borderColor: selected === plan.code ? color.primary : color.border,
            borderRadius: radius.sm,
            borderWidth: selected === plan.code ? 2 : 1,
            justifyContent: 'center',
            minHeight: touchTargetDp,
            paddingHorizontal: space.s3,
          }}
        >
          <Text style={{ color: color.text }}>{plan.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function QuoteBlock({
  quote,
  plan,
  expired,
  onRenew,
}: {
  quote: Quote;
  plan: RatePlanPublic | undefined;
  expired: boolean;
  onRenew: () => void;
}): ReactElement {
  return (
    <>
      {!expired ? null : (
        <View style={{ gap: space.s2 }}>
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{ color: color.warning }}
          >
            {t('room.expired')}
          </Text>
          <TextAction label={t('room.renew')} onPress={onRenew} />
        </View>
      )}
      <NightsTable quote={quote} />
      <Totals quote={quote} />
      <Text style={{ color: color.textMuted }}>
        {t('room.summary.quotedAt', { time: formatDateTimeVn(quote.quotedAt) })}
      </Text>
      <Text style={{ color: color.textMuted }}>
        {t('room.summary.expiresAt', { time: formatDateTimeVn(quote.expiresAt) })}
      </Text>
      <Text style={{ color: color.textMuted }}>
        {t('room.engine', { version: quote.engineVersion })}
      </Text>
      {plan === undefined ? null : <Terms plan={plan} />}
    </>
  );
}

function RoomView({
  view,
  selected,
  busy,
  onSelect,
  onRetry,
  onRenew,
}: {
  view: DetailView;
  selected: RatePlanCode | null;
  busy: boolean;
  onSelect: (code: string) => void;
  onRetry: () => void;
  onRenew: () => void;
}): ReactElement {
  if (view.kind === 'invalid')
    return (
      <Text accessibilityRole="alert" style={{ color: color.danger }}>
        {t('room.invalid')}
      </Text>
    );
  if (view.kind === 'loading')
    return <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />;
  if (view.kind === 'offline') return <Problem kind="offline" code={null} onRetry={onRetry} />;
  if (view.kind === 'failed') return <Problem kind="failed" code={view.code} onRetry={onRetry} />;
  if (view.kind === 'empty') return <Problem kind="empty" code={null} onRetry={onRetry} />;
  const plan = view.plans.find((item) => item.code === selected);
  return (
    <>
      <PlanPicker plans={view.plans} selected={selected} busy={busy} onSelect={onSelect} />
      {view.quote === null ? null : (
        <QuoteBlock quote={view.quote} plan={plan} expired={view.expired} onRenew={onRenew} />
      )}
    </>
  );
}

export default function RoomDetailScreen(): ReactElement {
  const params = useLocalSearchParams<Record<string, string>>();
  const criteria: RoomCriteria | null = useMemo(() => criteriaFromParams(params), [params]);
  const roomName =
    typeof params.name === 'string' && params.name !== ''
      ? params.name
      : (criteria?.roomTypeId ?? '');

  const api = useMemo(() => createPublicJourneyApi(createAppApiClient()), []);
  const net = useMemo(() => netInfoSource(), []);
  const [plans, setPlans] = useState<PlansOutcome | null>(null);
  const [quote, setQuote] = useState<QuoteOutcome | null>(null);
  const [selected, setSelected] = useState<RatePlanCode | null>(null);
  const [busy, setBusy] = useState(false);

  const runQuote = useCallback(
    async (code: string): Promise<void> => {
      const plan = planCodeOf(code);
      if (plan === null || criteria === null) return;
      setBusy(true);
      setSelected(plan);
      setQuote(await loadQuote({ api, net }, criteria, plan));
      setBusy(false);
    },
    [api, criteria, net],
  );

  const load = useCallback(async (): Promise<void> => {
    if (criteria === null) return;
    setBusy(true);
    const loaded = await loadPlans({ api, net }, criteria);
    setPlans(loaded);
    const first = loaded.kind === 'ready' ? loaded.plans[0] : undefined;
    if (first !== undefined) await runQuote(first.code);
    setBusy(false);
  }, [api, criteria, net, runQuote]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = detailView({ criteria, plans, quote, nowMs: Date.now() });
  const retry = useCallback((): void => {
    void load();
  }, [load]);

  return (
    <ScrollView contentContainerStyle={{ gap: space.s3, padding: space.s4 }}>
      <Text
        accessibilityRole="header"
        style={{ color: color.text, fontSize: typography.h1.sp, fontWeight: '700' }}
      >
        {t('room.title')}
      </Text>
      {criteria === null ? null : (
        <Text style={{ color: color.text }}>
          {roomName} · {criteria.checkIn} → {criteria.checkOut}
        </Text>
      )}
      <RoomView
        view={view}
        selected={selected}
        busy={busy}
        onSelect={(code) => {
          void runQuote(code);
        }}
        onRetry={retry}
        onRenew={() => {
          if (selected !== null) void runQuote(selected);
        }}
      />
    </ScrollView>
  );
}
