/**
 * SCR-76 + SCR-78 (HB-087) — xác nhận & giữ chỗ trên Android.
 *
 * Một thao tác của khách: nhập họ tên/SĐT → `POST /holds` (giữ chỗ có hạn) → `POST /bookings` (tạo đặt
 * phòng). Sau đó màn hình đếm ngược theo `expiresAt` **của máy chủ** và khoá nút tiếp tục khi hết hạn;
 * nếu máy chủ nghi trùng thì hỏi khách thay vì tự tạo thêm.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  color,
  radius,
  space,
  touchTargetDp,
  typography,
  formatDateTimeVn,
} from '@pinehill/ui-native';
import type { BookingSummary, Hold, RatePlanCode } from '@pinehill/contracts';
import { createSession } from '../../src/session-factory';
import { holdApiFrom } from '../../src/hold-api';
import { netInfoSource } from '../../src/netinfo.native';
import { t } from '../../src/strings';
import { formatVnd } from '../../src/search';
import { planCodeOf } from '../../src/room-detail';
import {
  bookingResult,
  continueEnabled,
  finishBooking,
  formatCountdown,
  guestIssue,
  holdRemaining,
  startHold,
  type GuestContact,
  type HoldApi,
  type HoldCriteria,
  type HoldInput,
  type HoldOutcome,
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
        style={{
          borderColor: color.border,
          borderRadius: radius.sm,
          borderWidth: 1,
          color: color.text,
          minHeight: touchTargetDp,
          paddingHorizontal: space.s3,
        }}
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
      style={{
        alignItems: 'center',
        backgroundColor: disabled ? color.borderStrong : color.primary,
        borderRadius: radius.sm,
        justifyContent: 'center',
        minHeight: touchTargetDp,
      }}
    >
      <Text style={{ color: color.surface, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function HoldLine({ hold, nowMs }: { hold: Hold; nowMs: number }): ReactElement {
  const remaining = holdRemaining(hold, nowMs);
  const locked = remaining !== null && remaining <= 0;
  return (
    <View style={{ gap: space.s1 }} accessible>
      <Text style={{ color: locked ? color.warning : color.text }}>
        {t('hold.countdown', { time: formatCountdown(remaining ?? 0) })}
      </Text>
      <Text style={{ color: color.textMuted }}>
        {t('hold.expiresAt', { time: formatDateTimeVn(hold.expiresAt) })}
      </Text>
    </View>
  );
}

function Result({ booking }: { booking: BookingSummary }): ReactElement {
  return (
    <View style={{ gap: space.s1 }} accessible>
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {t('hold.result.title')}
      </Text>
      <Text style={CELL}>{t('hold.result.code', { code: booking.code })}</Text>
      <Text style={CELL}>{t('hold.result.status', { status: booking.status })}</Text>
      <Text style={CELL}>
        {t('hold.result.total', {
          amount: t('room.money', { amount: formatVnd(booking.totalAmount) }),
        })}
      </Text>
    </View>
  );
}

function Outcome({
  hold,
  nowMs,
  booking,
  duplicate,
  continueOn,
  onOpenOld,
  onKeep,
  onContinue,
}: {
  hold: Hold | null;
  nowMs: number;
  booking: BookingSummary | null;
  duplicate: boolean;
  continueOn: boolean;
  onOpenOld: () => void;
  onKeep: () => void;
  onContinue: () => void;
}): ReactElement {
  const locked = hold !== null && !continueEnabled(hold, nowMs);
  return (
    <>
      {hold === null ? null : <HoldLine hold={hold} nowMs={nowMs} />}
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
  const params = useLocalSearchParams<Record<string, string>>();
  const router = useRouter();
  const parsed = useMemo(() => confirmParamsFrom(params), [params]);
  const session = useMemo(() => createSession(), []);
  const net = useMemo(() => netInfoSource(), []);
  const [ready, setReady] = useState(false);
  const [guest, setGuest] = useState<GuestContact>({ fullName: '', phone: '' });
  const [note, setNote] = useState('');
  const [issue, setIssue] = useState<'NAME' | 'PHONE' | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
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
    if (hold === null) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [hold]);

  const api: HoldApi = useMemo(() => holdApiFrom(session.apiClient()), [session]);

  const submit = useCallback(async (): Promise<void> => {
    if (parsed === null) return;
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
    // Đã giữ chỗ rồi (lần trước hỏng ở bước đặt phòng) thì chỉ đặt lại, không tạo chỗ giữ thứ hai.
    let held: HoldOutcome;
    if (hold === null) {
      held = await startHold({ api, net }, input);
    } else {
      held = { kind: 'ready', hold };
    }
    if (held.kind === 'offline') {
      setAlert(t('guest.offline'));
      setBusy(false);
      return;
    }
    if (held.kind === 'failed') {
      setAlert(t('hold.failed', { code: held.code ?? 'UNKNOWN' }));
      setBusy(false);
      return;
    }
    setHold(held.hold);
    setNowMs(Date.now());
    const result = bookingResult(await finishBooking({ api, net }, input));
    setBusy(false);
    if (result.offline) {
      setAlert(t('guest.offline'));
      return;
    }
    if (result.failedCode !== null) {
      setAlert(t('hold.failed', { code: result.failedCode }));
      return;
    }
    setBooking(result.booking);
    setDuplicate(result.duplicate);
  }, [api, guest, net, note, parsed]);

  if (parsed === null) {
    return (
      <View style={{ gap: space.s3, padding: space.s4 }}>
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {t('hold.invalid')}
        </Text>
      </View>
    );
  }

  if (!ready)
    return <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />;

  if (!session.hasAccessToken()) {
    return (
      <View style={{ gap: space.s3, padding: space.s4 }}>
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {t('guest.title')}
        </Text>
        <Action
          label={t('guest.login')}
          onPress={() => {
            router.push('/');
          }}
        />
      </View>
    );
  }

  const openBooking = (): void => {
    if (booking !== null)
      router.push({ pathname: '/booking/[code]', params: { code: booking.code } });
  };

  return (
    <ScrollView contentContainerStyle={{ gap: space.s3, padding: space.s4 }}>
      <Text
        accessibilityRole="header"
        style={{ color: color.text, fontSize: typography.h1.sp, fontWeight: '700' }}
      >
        {t('hold.title')}
      </Text>
      <Text style={CELL}>
        {parsed.criteria.checkIn} → {parsed.criteria.checkOut} · {parsed.criteria.roomCount} phòng
      </Text>

      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
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
        disabled={busy}
        onPress={() => {
          void submit();
        }}
      />
      {busy ? (
        <ActivityIndicator accessibilityLabel={t('state.loading')} color={color.primary} />
      ) : null}

      <Outcome
        hold={hold}
        nowMs={nowMs}
        booking={booking}
        duplicate={duplicate}
        continueOn={continueEnabled(hold, nowMs) && !busy}
        onOpenOld={openBooking}
        onKeep={() => {
          setDuplicate(false);
        }}
        onContinue={openBooking}
      />
    </ScrollView>
  );
}
