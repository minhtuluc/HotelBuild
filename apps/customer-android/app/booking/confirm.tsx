/**
 * SCR-76 + SCR-78 (HB-087) — xác nhận & giữ chỗ trên Android.
 *
 * Một thao tác của khách: nhập họ tên/SĐT → báo giá trong phiên → `POST /bookings` (máy chủ tự giữ chỗ,
 * HB-253). Sau đó màn hình đếm ngược theo `holdExpiresAt` **của máy chủ** và khoá nút tiếp tục khi hết
 * hạn; nếu máy chủ nghi trùng thì hỏi khách thay vì tự tạo thêm.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { color, space, formatDateTimeVn } from '@pinehill/ui-native';
import type { BookingSummary, RatePlanCode } from '@pinehill/contracts';
import { LoginPrompt } from '../../src/login-prompt';
import { createSession } from '../../src/session-factory';
import { holdApiFrom } from '../../src/hold-api';
import { netInfoSource } from '../../src/netinfo-device.native';
import { t } from '../../src/strings';
import { calendarDateLabel } from '../../src/calendar-date';
import { formatVnd } from '../../src/search';
import { planCodeOf } from '../../src/room-detail';
import { useStableSearchParams } from '../../src/stable-params';
import { theme } from '../../src/theme';
import {
  bookingResult,
  continueEnabled,
  formatCountdown,
  guestIssue,
  holdRemaining,
  placeBooking,
  type GuestContact,
  type HoldApi,
  type HoldCriteria,
  type HoldInput,
} from '../../src/hold';

const TICK_MS = 1000;
const CELL = { color: color.text } as const;

interface ConfirmParams {
  readonly criteria: HoldCriteria;
  readonly ratePlanCode: RatePlanCode;
  readonly quoteId: string;
}

interface GuestCounts {
  readonly adults: number;
  readonly children: number;
  readonly roomCount: number;
}

function countsFrom(params: Readonly<Record<string, string>>): GuestCounts | null {
  const positive = (value: string | undefined): number | null => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isNaN(parsed) ? null : parsed;
  };
  const adults = positive(params.adults);
  const children = positive(params.children);
  const roomCount = positive(params.roomCount);
  if (adults === null || children === null || roomCount === null) return null;
  return { adults, children, roomCount };
}

function confirmParamsFrom(params: Readonly<Record<string, string>>): ConfirmParams | null {
  const { propertyId, roomTypeId, checkIn, checkOut, quoteId } = params;
  if (
    propertyId === undefined ||
    roomTypeId === undefined ||
    checkIn === undefined ||
    checkOut === undefined ||
    quoteId === undefined ||
    quoteId === ''
  )
    return null;
  const counts = countsFrom(params);
  if (counts === null) return null;
  const ratePlanCode = planCodeOf(params.ratePlanCode ?? '');
  if (ratePlanCode === null) return null;
  return {
    criteria: { propertyId, roomTypeId, checkIn, checkOut, ...counts },
    ratePlanCode,
    quoteId,
  };
}

function Field({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}): ReactElement {
  return (
    <View style={{ gap: space.s1 }}>
      <Text style={CELL}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'phone-pad' : 'default'}
        autoCapitalize={numeric ? 'none' : 'words'}
        style={theme.field}
      />
    </View>
  );
}

function Action({
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
      style={[theme.buttonPrimary, disabled ? { backgroundColor: color.borderStrong } : null]}
    >
      <Text style={theme.buttonPrimaryText}>{label}</Text>
    </Pressable>
  );
}

function HoldLine({ expiresAt, nowMs }: { expiresAt: string; nowMs: number }): ReactElement {
  const remaining = holdRemaining(expiresAt, nowMs);
  const locked = remaining !== null && remaining <= 0;
  return (
    <View style={theme.card} accessible>
      <Text style={[{ color: locked ? color.warning : color.text }, theme.tabular]}>
        {t('hold.countdown', { time: formatCountdown(remaining ?? 0) })}
      </Text>
      <Text style={theme.muted}>{t('hold.expiresAt', { time: formatDateTimeVn(expiresAt) })}</Text>
    </View>
  );
}

function Result({ booking }: { booking: BookingSummary }): ReactElement {
  return (
    <View style={theme.card} accessible>
      <Text accessibilityRole="header" style={theme.sectionTitle}>
        {t('hold.result.title')}
      </Text>
      <Text style={CELL}>{t('hold.result.code', { code: booking.code })}</Text>
      <Text style={CELL}>{t('hold.result.status', { status: booking.status })}</Text>
      <Text style={[CELL, theme.tabular]}>
        {t('hold.result.total', {
          amount: t('room.money', { amount: formatVnd(booking.totalAmount) }),
        })}
      </Text>
    </View>
  );
}

function Outcome({
  nowMs,
  booking,
  duplicate,
  continueOn,
  onOpenOld,
  onKeep,
  onContinue,
}: {
  nowMs: number;
  booking: BookingSummary | null;
  duplicate: boolean;
  continueOn: boolean;
  onOpenOld: () => void;
  onKeep: () => void;
  onContinue: () => void;
}): ReactElement {
  const expiresAt = booking?.holdExpiresAt ?? null;
  const locked = booking !== null && !continueEnabled(booking, nowMs);
  return (
    <>
      {expiresAt === null ? null : <HoldLine expiresAt={expiresAt} nowMs={nowMs} />}
      {!locked ? null : (
        <Text accessibilityRole="alert" style={{ color: color.warning }}>
          {t('hold.locked')}
        </Text>
      )}
      {!duplicate || booking === null ? null : (
        <View style={{ gap: space.s2 }}>
          <Text accessibilityRole="alert" style={{ color: color.warning }}>
            {t('hold.duplicate', { code: booking.code })}
          </Text>
          <Action label={t('hold.duplicate.open')} onPress={onOpenOld} />
          <Action label={t('hold.duplicate.keep')} onPress={onKeep} />
        </View>
      )}
      {booking === null ? null : <Result booking={booking} />}
      {booking === null ? null : (
        <Action label={t('hold.open')} disabled={!continueOn} onPress={onContinue} />
      )}
    </>
  );
}

export default function ConfirmHoldScreen(): ReactElement {
  const params = useStableSearchParams();
  const router = useRouter();
  const parsed = useMemo(() => confirmParamsFrom(params), [params]);
  const session = useMemo(() => createSession(), []);
  const net = useMemo(() => netInfoSource(), []);
  const [ready, setReady] = useState(false);
  const [guest, setGuest] = useState<GuestContact>({ fullName: '', phone: '' });
  const [note, setNote] = useState('');
  const [issue, setIssue] = useState<'NAME' | 'PHONE' | null>(null);
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Phiên khách: mở lại app thì refresh im lặng để có access token cho hai tuyến cần đăng nhập.
  useEffect(() => {
    let cancelled = false;
    void session.silentRefresh().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Nhịp vẽ lại đếm ngược; hạn thật vẫn là mốc máy chủ trả.
  useEffect(() => {
    if (booking?.holdExpiresAt == null) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [booking]);

  const api: HoldApi = useMemo(() => holdApiFrom(session.apiClient()), [session]);

  const submit = useCallback(async (): Promise<void> => {
    // Đã có booking thì không đặt lần hai (thử lại chỉ sau khi lệnh trước thất bại).
    if (parsed === null || booking !== null) return;
    const found = guestIssue(guest);
    setIssue(found);
    if (found !== null) return;
    const input: HoldInput = {
      criteria: parsed.criteria,
      ratePlanCode: parsed.ratePlanCode,
      quoteId: parsed.quoteId,
      guest,
      ...(note.trim() === '' ? {} : { note }),
    };
    setBusy(true);
    setAlert(null);
    const result = bookingResult(await placeBooking({ api, net }, input));
    setBusy(false);
    if (result.offline) {
      setAlert(t('guest.offline'));
      return;
    }
    if (result.failedCode !== null) {
      setAlert(t('hold.failed', { code: result.failedCode }));
      return;
    }
    setNowMs(Date.now());
    setBooking(result.booking);
    setDuplicate(result.duplicate);
  }, [api, booking, guest, net, note, parsed]);

  if (parsed === null) {
    return (
      <View style={theme.screen}>
        <Text accessibilityRole="alert" style={theme.alertDanger}>
          {t('hold.invalid')}
        </Text>
      </View>
    );
  }

  if (!ready)
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color.bg,
        }}
      >
        <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />
      </View>
    );

  if (!session.hasAccessToken()) {
    return (
      <View style={theme.screen}>
        <LoginPrompt hint="hold.loginHint" />
      </View>
    );
  }

  const openBooking = (): void => {
    if (booking !== null)
      router.push({ pathname: '/booking/[code]', params: { code: booking.code } });
  };

  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <Text accessibilityRole="header" style={theme.title}>
        {t('hold.title')}
      </Text>
      <Text style={CELL}>
        {t('hold.criteria', {
          checkIn: calendarDateLabel(parsed.criteria.checkIn),
          checkOut: calendarDateLabel(parsed.criteria.checkOut),
          roomCount: parsed.criteria.roomCount,
        })}
      </Text>

      <Text accessibilityRole="header" style={theme.sectionTitle}>
        {t('hold.guest.title')}
      </Text>
      <Field
        label={t('hold.fullName')}
        value={guest.fullName}
        onChange={(value) => {
          setGuest((previous) => ({ ...previous, fullName: value }));
        }}
      />
      <Field
        label={t('hold.phone')}
        value={guest.phone}
        numeric
        onChange={(value) => {
          setGuest((previous) => ({ ...previous, phone: value }));
        }}
      />
      <Field label={t('hold.note')} value={note} onChange={setNote} />

      {issue === null ? null : (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {t(issue === 'NAME' ? 'hold.issue.NAME' : 'hold.issue.PHONE')}
        </Text>
      )}
      {alert === null ? null : (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: color.danger }}
        >
          {alert}
        </Text>
      )}

      <Action
        label={t('hold.submit')}
        disabled={busy || booking !== null}
        onPress={() => {
          void submit();
        }}
      />
      {busy ? (
        <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />
      ) : null}

      <Outcome
        nowMs={nowMs}
        booking={booking}
        duplicate={duplicate}
        continueOn={continueEnabled(booking, nowMs) && !busy}
        onOpenOld={openBooking}
        onKeep={() => {
          setDuplicate(false);
        }}
        onContinue={openBooking}
      />
    </ScrollView>
  );
}
