/**
 * SCR-82 (HB-114) — đổi ngày lưu trú trên Android.
 *
 * Trình tự (thiết kế §8.1–8.3): nhập kỳ mới → **xem chênh lệch** bằng báo giá máy chủ cho kỳ mới
 * (`POST /quotes`) → mới mở nút xác nhận → `POST /bookings/{id}/reschedule` kèm `quoteId`.
 *
 * Ghi chú hợp đồng: phản hồi đổi ngày là `bookingSummary` — **không** có trường chênh lệch/phí. App không
 * tự tính tiền (ADR-018): chênh lệch là hiệu của hai con số máy chủ trả, phí thì nói rõ hợp đồng chưa có.
 * Mất mạng: nút xem chênh lệch/xác nhận **khoá** (QĐ-03 quyết định 6), báo giá đã có chỉ để đọc.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { color, radius, space, touchTargetDp, typography } from '@pinehill/ui-native';
import { createBookingApi } from '@pinehill/api-client';
import type { BookingSummary, Quote } from '@pinehill/contracts';
import { createSession } from '../../../src/session-factory';
import { secureStorage } from '../../../src/storage.native';
import { netInfoSource } from '../../../src/netinfo.native';
import { t } from '../../../src/strings';
import { bookingOf, loadOrderDetail, stayOf, type OrderDetailOutcome } from '../../../src/orders';
import { OrderNotices } from '../../../src/order-view';
import { bookingActionsFrom } from '../../../src/booking-actions-api';
import {
  STAY_ISSUE_KEYS,
  actionStates,
  confirmReschedule,
  isSameStay,
  loadNewQuote,
  rescheduleRequestFor,
  stayIssue,
  type RescheduleActionStates,
  type RescheduleStep,
  type StayIssue,
} from '../../../src/reschedule';
import { DiffPanel, ResultPanel } from '../../../src/reschedule-panels';

const BUTTON = {
  alignItems: 'center',
  borderColor: color.border,
  borderRadius: radius.sm,
  borderWidth: 1,
  justifyContent: 'center',
  minHeight: touchTargetDp,
  paddingHorizontal: space.s3,
} as const;

const FIELD = {
  borderColor: color.border,
  borderRadius: radius.sm,
  borderWidth: 1,
  color: color.text,
  minHeight: touchTargetDp,
  paddingHorizontal: space.s3,
} as const;

function Messages({ online, alert }: { online: boolean; alert: string | null }): ReactElement {
  return (
    <>
      {!online ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          data-testid="reschedule-offline"
          style={{ color: color.warning }}
        >
          {t('booking.reschedule.offline')}
        </Text>
      ) : null}
      {alert === null ? null : (
        <Text
          accessibilityRole="alert"
          data-testid="reschedule-alert"
          style={{ color: color.danger }}
        >
          {alert}
        </Text>
      )}
    </>
  );
}

function RescheduleForm({
  checkIn,
  checkOut,
  note,
  quote,
  currentTotal,
  issue,
  same,
  step,
  states,
  onChangeCheckIn,
  onChangeCheckOut,
  onChangeNote,
  onCheck,
  onConfirm,
}: {
  checkIn: string;
  checkOut: string;
  note: string;
  quote: Quote | null;
  currentTotal: number;
  issue: StayIssue | null;
  same: boolean;
  step: RescheduleStep;
  states: RescheduleActionStates;
  onChangeCheckIn: (value: string) => void;
  onChangeCheckOut: (value: string) => void;
  onChangeNote: (value: string) => void;
  onCheck: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <>
      <TextInput
        accessibilityLabel={t('booking.reschedule.checkIn')}
        autoCapitalize="none"
        maxLength={10}
        placeholder="YYYY-MM-DD"
        value={checkIn}
        onChangeText={onChangeCheckIn}
        style={FIELD}
      />
      <TextInput
        accessibilityLabel={t('booking.reschedule.checkOut')}
        autoCapitalize="none"
        maxLength={10}
        placeholder="YYYY-MM-DD"
        value={checkOut}
        onChangeText={onChangeCheckOut}
        style={FIELD}
      />
      <TextInput
        accessibilityLabel={t('booking.reschedule.note')}
        maxLength={500}
        value={note}
        onChangeText={onChangeNote}
        style={FIELD}
      />
      {issue === null ? null : (
        <Text
          accessibilityRole="alert"
          data-testid="reschedule-issue"
          style={{ color: color.danger }}
        >
          {t(STAY_ISSUE_KEYS[issue])}
        </Text>
      )}
      {!same ? null : (
        <Text
          accessibilityRole="alert"
          data-testid="reschedule-same"
          style={{ color: color.warning }}
        >
          {t('booking.reschedule.issue.same')}
        </Text>
      )}
      {!states.quoteExpired ? null : (
        <Text
          accessibilityRole="alert"
          data-testid="reschedule-expired"
          style={{ color: color.warning }}
        >
          {t('booking.reschedule.staleQuote')}
        </Text>
      )}
      <Text style={{ color: color.textMuted }}>{t('booking.reschedule.checkRequired')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('booking.reschedule.check')}
        accessibilityState={{ busy: step === 'quoting', disabled: states.quoteDisabled }}
        disabled={states.quoteDisabled}
        onPress={onCheck}
        style={BUTTON}
      >
        <Text style={{ color: color.primary }}>{t('booking.reschedule.check')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('booking.reschedule.confirm')}
        accessibilityState={{ busy: step === 'submitting', disabled: states.confirmDisabled }}
        disabled={states.confirmDisabled}
        onPress={onConfirm}
        style={BUTTON}
      >
        <Text style={{ color: color.danger }}>{t('booking.reschedule.confirm')}</Text>
      </Pressable>
      {quote === null ? null : (
        <DiffPanel
          currentTotal={currentTotal}
          quote={quote}
          checkIn={checkIn}
          checkOut={checkOut}
        />
      )}
    </>
  );
}

export default function RescheduleBookingScreen(): ReactElement {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' ? params.code : '';
  const session = useMemo(() => createSession(), []);
  const net = useMemo(() => netInfoSource(), []);
  const storage = useMemo(() => secureStorage(), []);
  const client = useMemo(() => session.apiClient(), [session]);
  const actions = useMemo(() => bookingActionsFrom(client), [client]);
  const orders = useMemo(
    () => ({
      list: (query: { q?: string; limit?: number }) =>
        createBookingApi(client)
          .list(query)
          .then((response) => response.data),
    }),
    [client],
  );
  const [ready, setReady] = useState(false);
  const [outcome, setOutcome] = useState<OrderDetailOutcome | null>(null);
  const [online, setOnline] = useState(true);
  const [step, setStep] = useState<RescheduleStep>('idle');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [result, setResult] = useState<BookingSummary | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void session
      .silentRefresh()
      .catch(() => false)
      .then(() => {
        if (!cancelled) setReady(true);
      });
    void net
      .getConnected()
      .catch(() => false)
      .then((connected) => {
        if (!cancelled) setOnline(connected);
      });
    return () => {
      cancelled = true;
    };
  }, [session, net]);

  const load = useCallback(async (): Promise<void> => {
    if (code === '') return;
    setBusy(true);
    const loaded = await loadOrderDetail({ api: orders, net, storage, nowMs: Date.now() }, code);
    setOutcome(loaded);
    const booking = bookingOf(loaded);
    if (booking !== null) {
      setCheckIn((current) => (current === '' ? booking.checkIn : current));
      setCheckOut((current) => (current === '' ? booking.checkOut : current));
    }
    setBusy(false);
  }, [code, net, orders, storage]);

  useEffect(() => {
    if (ready) void load();
  }, [load, ready]);

  // Kỳ đổi thì báo giá cũ không còn đúng ngày: bỏ nó và khoá lại nút xác nhận.
  const changeCheckIn = useCallback((value: string): void => {
    setCheckIn(value);
    setQuote(null);
    setStep('idle');
  }, []);
  const changeCheckOut = useCallback((value: string): void => {
    setCheckOut(value);
    setQuote(null);
    setStep('idle');
  }, []);

  const booking = bookingOf(outcome);
  const issue = stayIssue(checkIn, checkOut);
  const same = booking !== null && isSameStay(booking, { checkIn, checkOut });

  const checkPrice = useCallback(async (): Promise<void> => {
    if (booking === null) return;
    setAlert(null);
    setQuote(null);
    setStep('quoting');
    const fresh = await loadNewQuote({ api: actions, net }, booking, checkIn, checkOut);
    if (fresh.kind === 'offline') {
      setOnline(false);
      setStep('idle');
      setAlert(t('booking.reschedule.offline'));
      return;
    }
    if (fresh.kind === 'invalidPlan') {
      setStep('idle');
      setAlert(t('booking.reschedule.planUnresolved'));
      return;
    }
    if (fresh.kind === 'failed') {
      setStep('idle');
      setAlert(t('booking.reschedule.failed', { code: fresh.code ?? 'UNKNOWN' }));
      return;
    }
    setQuote(fresh.quote);
    setStep('quoted');
  }, [actions, net, booking, checkIn, checkOut]);

  const confirm = useCallback(async (): Promise<void> => {
    if (booking === null || quote === null) return;
    if (quote.checkIn !== checkIn || quote.checkOut !== checkOut) return;
    setAlert(null);
    setStep('submitting');
    const request = rescheduleRequestFor({ checkIn, checkOut, quoteId: quote.quoteId, note });
    const done = await confirmReschedule({ api: actions, net }, booking.id, request);
    if (done.kind === 'offline') {
      setOnline(false);
      setStep('quoted');
      setAlert(t('booking.reschedule.offline'));
      return;
    }
    if (done.kind === 'failed') {
      setStep('quoted');
      setAlert(t('booking.reschedule.failed', { code: done.code ?? 'UNKNOWN' }));
      return;
    }
    setResult(done.booking);
    setOutcome({ kind: 'ready', booking: done.booking });
    setStep('done');
  }, [actions, net, booking, checkIn, checkOut, note, quote]);

  if (!ready || busy)
    return <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />;

  const states = actionStates({ step, online, issue, same, quote, nowMs: Date.now() });
  return (
    <ScrollView contentContainerStyle={{ gap: space.s3, padding: space.s4 }}>
      <Text
        accessibilityRole="header"
        style={{ color: color.text, fontSize: typography.h1.sp, fontWeight: '700' }}
      >
        {t('booking.reschedule.title')}
      </Text>
      <OrderNotices outcome={outcome} />
      <Messages online={online} alert={alert} />
      {booking === null ? null : (
        <View style={{ gap: space.s1 }}>
          <Text style={{ color: color.text }} data-testid="reschedule-booking">
            {t('orders.detail.code', { code: booking.code })}
          </Text>
          <Text style={{ color: color.text }}>{stayOf(booking)}</Text>
        </View>
      )}
      {booking === null || result !== null ? null : (
        <RescheduleForm
          checkIn={checkIn}
          checkOut={checkOut}
          note={note}
          quote={quote}
          currentTotal={booking.totalAmount}
          issue={issue}
          same={same}
          step={step}
          states={states}
          onChangeCheckIn={changeCheckIn}
          onChangeCheckOut={changeCheckOut}
          onChangeNote={setNote}
          onCheck={() => void checkPrice()}
          onConfirm={() => void confirm()}
        />
      )}
      {result === null ? null : <ResultPanel booking={result} />}
      <Link
        href={{ pathname: '/booking/[code]', params: { code } }}
        accessibilityLabel={t('booking.reschedule.back')}
        style={{ color: color.primary, minHeight: touchTargetDp, padding: space.s3 }}
      >
        {t('booking.reschedule.back')}
      </Link>
    </ScrollView>
  );
}
