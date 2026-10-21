/**
 * SCR-81 (HB-114) — huỷ đặt phòng & số tiền hoàn trên Android.
 *
 * Trình tự bắt buộc (thiết kế §8.1–8.3):
 * 1. **Luôn** xem trước số tiền hoàn (`POST .../cancel-preview`) trước khi mở nút xác nhận.
 * 2. Ngay trước khi huỷ, lớp thuần **đối chiếu lại** với máy chủ: số liệu đổi thì không huỷ, hiện số mới
 *    và buộc khách xác nhận lần nữa.
 * 3. Mất mạng: nút xem trước/xác nhận **khoá** (QĐ-03 quyết định 6); bản xem trước đã có chỉ để đọc.
 *
 * Giao diện không tính tiền, không suy luật chính sách (ADR-018): mọi con số là nguyên văn máy chủ trả.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import {
  color,
  radius,
  space,
  touchTargetDp,
  typography,
  formatDateTimeVn,
} from '@pinehill/ui-native';
import { createBookingApi } from '@pinehill/api-client';
import type { CancelPreview, CancelResponse } from '@pinehill/contracts';
import { createSession } from '../../../src/session-factory';
import { secureStorage } from '../../../src/storage.native';
import { netInfoSource } from '../../../src/netinfo.native';
import { t, type MessageKey } from '../../../src/strings';
import { formatVnd } from '../../../src/search';
import {
  ORDER_STATUS_KEYS,
  bookingOf,
  loadOrderDetail,
  stayOf,
  type OrderDetailOutcome,
} from '../../../src/orders';
import { OrderNotices } from '../../../src/order-view';
import { bookingActionsFrom } from '../../../src/booking-actions-api';
import {
  CANCEL_REASONS,
  CANCEL_REASON_KEYS,
  actionStates,
  cancelRequestFor,
  confirmCancel,
  formatHoursBeforeCheckIn,
  loadPreview,
  refundRows,
  type CancelReason,
  type CancelStep,
  type RefundRow,
} from '../../../src/cancel';

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

const REFUND_KEYS: Readonly<Record<RefundRow['key'], MessageKey>> = {
  paid: 'booking.cancel.refund.paid',
  requested: 'booking.cancel.refund.requested',
  penalty: 'booking.cancel.refund.penalty',
  fee: 'booking.cancel.refund.fee',
};

function money(amount: number): string {
  return t('orders.money', { amount: formatVnd(amount) });
}

function PreviewPanel({ preview }: { preview: CancelPreview }): ReactElement {
  const breakdown = preview.cancellation;
  return (
    <View style={{ gap: space.s1 }} data-testid="cancel-preview">
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {t('booking.cancel.previewTitle')}
      </Text>
      <Text style={{ color: color.text }} data-testid="cancel-tier">
        {t('booking.cancel.tier', {
          tier: breakdown.appliedTierId,
          hours: formatHoursBeforeCheckIn(breakdown.hoursBeforeCheckIn),
          percent: breakdown.refundPercent,
        })}
      </Text>
      {refundRows(breakdown).map((row) => (
        <Text
          key={row.key}
          accessible
          accessibilityLabel={`${t(REFUND_KEYS[row.key])}: ${money(row.amount)}`}
          style={{ color: color.textMuted }}
        >
          {`${t(REFUND_KEYS[row.key])}: ${money(row.amount)}`}
        </Text>
      ))}
      {(preview.warnings ?? []).map((warning) => (
        <Text key={warning} style={{ color: color.warning }}>
          {warning}
        </Text>
      ))}
    </View>
  );
}

function ResultPanel({ result }: { result: CancelResponse }): ReactElement {
  return (
    <View style={{ gap: space.s1 }} data-testid="cancel-result">
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {t('booking.cancel.resultTitle')}
      </Text>
      <Text style={{ color: color.text }} data-testid="cancel-result-status">
        {t(ORDER_STATUS_KEYS[result.status])}
      </Text>
      <Text style={{ color: color.text }}>
        {t('booking.cancel.resultAt', { time: formatDateTimeVn(result.cancelledAt) })}
      </Text>
      <Text style={{ color: color.text }}>
        {t('booking.cancel.resultReleased', { count: result.releasedAssignmentCount })}
      </Text>
      <Text style={{ color: color.text }} data-testid="cancel-result-refund">
        {result.refundRequest === null
          ? t('booking.cancel.resultNoRefund')
          : t('booking.cancel.resultRefund', {
              id: result.refundRequest.id,
              status: result.refundRequest.status,
              amount:
                result.refundRequest.approvedAmount === null
                  ? t('booking.cancel.resultRefundPending')
                  : money(result.refundRequest.approvedAmount),
            })}
      </Text>
    </View>
  );
}

function Messages({
  online,
  alert,
  stale,
}: {
  online: boolean;
  alert: string | null;
  stale: boolean;
}): ReactElement {
  return (
    <>
      {!online ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          data-testid="cancel-offline"
          style={{ color: color.warning }}
        >
          {t('booking.cancel.offline')}
        </Text>
      ) : null}
      {alert === null ? null : (
        <Text accessibilityRole="alert" data-testid="cancel-alert" style={{ color: color.danger }}>
          {alert}
        </Text>
      )}
      {stale ? (
        <Text accessibilityRole="alert" data-testid="cancel-stale" style={{ color: color.warning }}>
          {t('booking.cancel.stale')}
        </Text>
      ) : null}
    </>
  );
}

function CancelForm({
  reason,
  note,
  preview,
  step,
  online,
  onReason,
  onChangeNote,
  onPreview,
  onConfirm,
}: {
  reason: CancelReason;
  note: string;
  preview: CancelPreview | null;
  step: CancelStep;
  online: boolean;
  onReason: (value: CancelReason) => void;
  onChangeNote: (value: string) => void;
  onPreview: () => void;
  onConfirm: () => void;
}): ReactElement {
  const states = actionStates(step, online);
  return (
    <>
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {t('booking.cancel.reason')}
      </Text>
      {CANCEL_REASONS.map((value) => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          accessibilityLabel={t(CANCEL_REASON_KEYS[value])}
          accessibilityState={{ checked: reason === value, disabled: step !== 'idle' }}
          disabled={step !== 'idle'}
          onPress={() => onReason(value)}
          style={{ ...BUTTON, alignItems: 'flex-start' }}
        >
          <Text style={{ color: color.text }}>
            {`${reason === value ? '◉' : '○'} ${t(CANCEL_REASON_KEYS[value])}`}
          </Text>
        </Pressable>
      ))}
      <TextInput
        accessibilityLabel={t('booking.cancel.note')}
        maxLength={500}
        multiline
        value={note}
        onChangeText={onChangeNote}
        style={FIELD}
      />
      <Text style={{ color: color.textMuted }}>{t('booking.cancel.previewRequired')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('booking.cancel.preview')}
        accessibilityState={{ busy: step === 'computing', disabled: states.previewDisabled }}
        disabled={states.previewDisabled}
        onPress={onPreview}
        style={BUTTON}
      >
        <Text style={{ color: color.primary }}>{t('booking.cancel.preview')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('booking.cancel.confirm')}
        accessibilityState={{ busy: step === 'submitting', disabled: states.confirmDisabled }}
        disabled={states.confirmDisabled}
        onPress={onConfirm}
        style={BUTTON}
      >
        <Text style={{ color: color.danger }}>{t('booking.cancel.confirm')}</Text>
      </Pressable>
      {preview === null ? null : <PreviewPanel preview={preview} />}
    </>
  );
}

export default function CancelBookingScreen(): ReactElement {
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
  const [step, setStep] = useState<CancelStep>('idle');
  const [reason, setReason] = useState<CancelReason>('GUEST_REQUEST');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [stale, setStale] = useState(false);
  const [result, setResult] = useState<CancelResponse | null>(null);
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
    setOutcome(await loadOrderDetail({ api: orders, net, storage, nowMs: Date.now() }, code));
    setBusy(false);
  }, [code, net, orders, storage]);

  useEffect(() => {
    if (ready) void load();
  }, [load, ready]);

  const runPreview = useCallback(async (): Promise<void> => {
    const booking = bookingOf(outcome);
    if (booking === null) return;
    setAlert(null);
    setStale(false);
    setStep('computing');
    const fresh = await loadPreview({ api: actions, net }, booking.id, cancelRequestFor(reason));
    if (fresh.kind === 'offline') {
      setOnline(false);
      setStep(preview === null ? 'idle' : 'previewed');
      setAlert(t('booking.cancel.offline'));
      return;
    }
    if (fresh.kind === 'failed') {
      setStep(preview === null ? 'idle' : 'previewed');
      setAlert(t('booking.cancel.failed', { code: fresh.code ?? 'UNKNOWN' }));
      return;
    }
    setPreview(fresh.preview);
    setStep('previewed');
  }, [actions, net, outcome, preview, reason]);

  const confirm = useCallback(async (): Promise<void> => {
    const booking = bookingOf(outcome);
    if (booking === null || preview === null) return;
    setAlert(null);
    setStep('submitting');
    const confirmed = await confirmCancel(
      { api: actions, net },
      booking.id,
      cancelRequestFor(reason),
      preview,
      note,
    );
    if (confirmed.kind === 'offline') {
      setOnline(false);
      setStep('previewed');
      setAlert(t('booking.cancel.offline'));
      return;
    }
    if (confirmed.kind === 'failed') {
      setStep('previewed');
      setAlert(t('booking.cancel.failed', { code: confirmed.code ?? 'UNKNOWN' }));
      return;
    }
    if (confirmed.kind === 'stale') {
      setPreview(confirmed.preview);
      setStep('previewed');
      setStale(true);
      return;
    }
    setResult(confirmed.result);
    setStep('done');
  }, [actions, net, note, outcome, preview, reason]);

  const changeReason = useCallback((value: CancelReason): void => {
    setReason(value);
    setPreview(null);
    setStale(false);
    setStep('idle');
  }, []);

  if (!ready || busy)
    return <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />;

  const booking = bookingOf(outcome);
  return (
    <ScrollView contentContainerStyle={{ gap: space.s3, padding: space.s4 }}>
      <Text
        accessibilityRole="header"
        style={{ color: color.text, fontSize: typography.h1.sp, fontWeight: '700' }}
      >
        {t('booking.cancel.title')}
      </Text>
      <OrderNotices outcome={outcome} />
      <Messages online={online} alert={alert} stale={stale} />
      {booking === null ? null : (
        <View style={{ gap: space.s1 }}>
          <Text style={{ color: color.text }} data-testid="cancel-booking">
            {t('orders.detail.code', { code: booking.code })}
          </Text>
          <Text style={{ color: color.text }}>
            {t('orders.detail.status', { status: t(ORDER_STATUS_KEYS[booking.status]) })}
          </Text>
          <Text style={{ color: color.text }}>{stayOf(booking)}</Text>
        </View>
      )}
      {result === null ? null : <ResultPanel result={result} />}
      {result !== null || booking === null ? null : (
        <CancelForm
          reason={reason}
          note={note}
          preview={preview}
          step={step}
          online={online}
          onReason={changeReason}
          onChangeNote={setNote}
          onPreview={() => void runPreview()}
          onConfirm={() => void confirm()}
        />
      )}
      <Link
        href={{ pathname: '/booking/[code]', params: { code } }}
        accessibilityLabel={t('booking.cancel.back')}
        style={{ color: color.primary, minHeight: touchTargetDp, padding: space.s3 }}
      >
        {t('booking.cancel.back')}
      </Link>
    </ScrollView>
  );
}
