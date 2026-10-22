/**
 * SCR-64 — ghi no-show (UC-FO-04, BR-CANCEL-10, BR-FO-02). Biểu mẫu chỉ thu lý do (điền sẵn, sửa được) để
 * lễ tân đạt 4 chạm: Đến hôm nay → thẻ khách → Ghi no-show → Xác nhận. Màn **không** tính số tiền bị
 * tính hay quyết định "đã tới mốc" (ADR-018): đếm ngược chỉ hiển thị, nút xác nhận gửi được và máy chủ từ
 * chối bằng mã/lý do hiển thị nguyên văn. Mất mạng thì không gửi, không xếp hàng.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import type { BookingSummary, NoShowResponse } from '@pinehill/contracts';
import { color, space, touchTargetDp, typography } from '@pinehill/ui-native';
import { ActionButton } from '../arrivals/controls';
import { formatVnDateTime } from '../arrivals/format';
import type { ActionFailure } from '../arrivals/model';
import { formatBusinessDate } from '../housekeeping/date';
import { formatVnd } from '../lookup/view';
import { noShowText as text } from './messages';
import {
  countdownToMark,
  formatCountdown,
  noShowBody,
  reasonIssue,
  type ReasonIssue,
} from './model';
import type { NoShowWriter } from './writer';

export interface NoShowScreenProps {
  booking: BookingSummary;
  writer: NoShowWriter;
  /** Đồng hồ thiết bị (ms) chỉ cho đếm ngược hiển thị; bơm được để test. */
  now: () => number;
  /** Sau khi máy chủ xác nhận: danh sách khách đến tải lại khi được mở lại. */
  onChanged: () => void;
  onClose: () => void;
}

type Result =
  | { kind: 'done'; response: NoShowResponse }
  | { kind: 'offline' }
  | { kind: 'failed'; failure: ActionFailure };

function FailureNotice({ failure }: { failure: ActionFailure }): ReactElement {
  switch (failure.kind) {
    case 'rejected':
      return (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ gap: space.s1 }}>
          <Text style={{ color: color.danger, fontWeight: '700' }}>{text('rejected')}</Text>
          <Text>{text('rejectedCode', { code: failure.code })}</Text>
          <Text>{text('rejectedReason', { reason: failure.reason })}</Text>
        </View>
      );
    case 'conflict':
      return (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {text('conflict')}
        </Text>
      );
    case 'forbidden':
      return (
        <Text accessibilityRole="alert" style={{ color: color.danger }}>
          {text('failForbidden')}
        </Text>
      );
    case 'unknownOutcome':
      return (
        <Text accessibilityRole="alert" style={{ color: color.warning }}>
          {text('unknownOutcome', { reference: failure.reference })}
        </Text>
      );
  }
}

function ResultNotice({ result }: { result: Result | null }): ReactElement | null {
  if (result?.kind === 'offline')
    return (
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{ color: color.danger }}
      >
        {text('offlineBlock')}
      </Text>
    );
  return result?.kind === 'failed' ? <FailureNotice failure={result.failure} /> : null;
}

/** Đồng hồ hiển thị: cập nhật mỗi giây, dọn dẹp khi rời màn. */
function useClock(now: () => number): number {
  const [current, setCurrent] = useState(now());
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent(now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [now]);
  return current;
}

function Countdown({ checkIn, nowMs }: { checkIn: string; nowMs: number }): ReactElement {
  const countdown = countdownToMark(checkIn, nowMs);
  let label = text('countdownUnknown');
  if (countdown.kind === 'reached') label = text('countdownReached');
  if (countdown.kind === 'counting')
    label = text('countdown', { time: formatCountdown(countdown.remainingMs) });
  return (
    <View style={{ gap: space.s1 }}>
      <Text testID="no-show-countdown" accessibilityLiveRegion="none" style={{ fontWeight: '700' }}>
        {label}
      </Text>
      <Text style={{ color: color.textMuted }}>{text('countdownNote')}</Text>
    </View>
  );
}

function Done({
  booking,
  response,
  onClose,
}: {
  booking: BookingSummary;
  response: NoShowResponse;
  onClose: () => void;
}): ReactElement {
  return (
    <View style={{ flex: 1, padding: space.s4, gap: space.s3, backgroundColor: color.surface }}>
      <View testID="no-show-done" accessibilityLiveRegion="polite" style={{ gap: space.s2 }}>
        <Text style={{ color: color.success, fontWeight: '700' }}>
          {text('done', { code: booking.code, time: formatVnDateTime(response.markedAt) })}
        </Text>
        <Text>{text('penalty', { amount: formatVnd(response.penaltyAmount) })}</Text>
        <Text>{text('refundRequest', { value: response.refundRequestId ?? '—' })}</Text>
      </View>
      <ActionButton testID="no-show-close" label={text('close')} onPress={onClose} />
    </View>
  );
}

function useNoShowForm({
  booking,
  writer,
  onChanged,
}: Pick<NoShowScreenProps, 'booking' | 'writer' | 'onChanged'>) {
  const [reason, setReason] = useState(text('reasonDefault'));
  const [issue, setIssue] = useState<ReasonIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = async (): Promise<void> => {
    const problem = reasonIssue(reason);
    setIssue(problem);
    if (problem !== null) return;
    setBusy(true);
    const outcome = await writer.submit(noShowBody(booking.id, reason));
    if (!mounted.current || outcome.kind === 'closed') return;
    setBusy(false);
    setResult(outcome);
    if (outcome.kind === 'done') onChanged();
  };
  const edit = (value: string): void => {
    setReason(value);
    setIssue(null);
  };
  return { reason, issue, busy, result, submit, edit };
}

export function NoShowScreen(props: NoShowScreenProps): ReactElement {
  const { booking, now, onChanged, onClose } = props;
  const nowMs = useClock(now);
  const form = useNoShowForm(props);
  const { result, busy } = form;
  if (result?.kind === 'done')
    return <Done booking={booking} response={result.response} onClose={onClose} />;
  const unknown = result?.kind === 'failed' && result.failure.kind === 'unknownOutcome';
  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScrollView contentContainerStyle={{ padding: space.s4, gap: space.s3 }}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}
        >
          {text('title', { code: booking.code })}
        </Text>
        <Text>{text('stay', { checkIn: formatBusinessDate(booking.checkIn) })}</Text>
        <Text>{text('paid', { paid: formatVnd(booking.paidAmount) })}</Text>
        <Countdown checkIn={booking.checkIn} nowMs={nowMs} />
        <Text testID="no-show-policy" style={{ color: color.textMuted }}>
          {text('policy')}
        </Text>
        <Text>{text('reasonLabel')}</Text>
        <TextInput
          testID="no-show-reason"
          accessibilityLabel={text('reasonLabel')}
          value={form.reason}
          maxLength={600}
          editable={!busy}
          onChangeText={form.edit}
          style={{
            minHeight: touchTargetDp,
            paddingHorizontal: space.s3,
            borderWidth: 1,
            borderRadius: 8,
            color: color.text,
          }}
        />
        {form.issue === null ? null : (
          <Text
            accessibilityRole="alert"
            testID="no-show-reason-issue"
            style={{ color: color.danger }}
          >
            {text(form.issue === 'EMPTY' ? 'reasonEmpty' : 'reasonTooLong')}
          </Text>
        )}
        <ResultNotice result={result} />
      </ScrollView>
      <View style={{ padding: space.s4, gap: space.s2 }}>
        <ActionButton
          testID="no-show-submit"
          label={busy ? text('submitting') : text('submit')}
          disabled={busy}
          onPress={() => void form.submit()}
        />
        {unknown ? (
          <ActionButton
            testID="no-show-reconcile"
            label={text('reconcile')}
            tone="plain"
            onPress={() => {
              onChanged();
              onClose();
            }}
          />
        ) : null}
        <ActionButton testID="no-show-back" label={text('back')} tone="plain" onPress={onClose} />
      </View>
    </View>
  );
}
