/**
 * SCR-68 (HB-263) — đối soát nhanh tiền mặt theo ngày VN. Lễ tân thấy tổng mình thu; kế toán đếm quỹ của
 * từng người thu và chốt (🔒 PIN, khoá chống trùng giữ lại khi chưa rõ kết quả). Mọi số là của máy chủ.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { isApiError } from '@pinehill/api-client';
import { color, space } from '@pinehill/ui-native';
import type {
  ReconciliationCloseResponse,
  ReconciliationCollector,
  ReconciliationDaily,
  UserMe,
} from '@pinehill/contracts';
import type { Session } from '../session';
import { OfflineError } from '../netinfo';
import { ActionButton } from '../arrivals/controls';
import { formatVnd } from '../lookup/view';
import { PinPanel } from '../stay/controls';
import type { PinnedWriter } from '../stay/writer';
import { theme } from '../theme';
import { formatBusinessDate } from '../housekeeping/date';
import { cashText as text } from './messages';
import {
  businessDateVn,
  canClose,
  closeBodyFor,
  formatDifference,
  parseCountedCash,
  type CloseBody,
} from './model';
import { loadDaily } from './ports';

type Writer = PinnedWriter<CloseBody, ReconciliationCloseResponse>;

export interface CashScreenProps {
  readonly session: Session;
  readonly role: UserMe['role'];
  readonly createWriter: () => Writer;
  readonly onBack: () => void;
  readonly now?: () => number;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly daily: ReconciliationDaily }
  | { readonly kind: 'failed'; readonly message: string };

function failureText(caught: unknown): string {
  if (caught instanceof OfflineError) return text('offline');
  return text('failed', { code: isApiError(caught) ? (caught.code ?? 'UNKNOWN') : 'UNKNOWN' });
}

function submitMessage(outcome: Awaited<ReturnType<Writer['submit']>>): string {
  switch (outcome.kind) {
    case 'done':
      return text('done', {
        expected: formatVnd(outcome.response.expectedCash),
        counted: formatVnd(outcome.response.countedCash),
        difference: formatDifference(outcome.response.difference),
      });
    case 'offline':
      return text('offline');
    case 'pinRequired':
      return text('pinRequired');
    case 'failed':
      return outcome.failure.kind === 'unknownOutcome'
        ? text('unknown', { reference: outcome.failure.reference })
        : text('rejected', {
            code: outcome.failure.kind === 'rejected' ? outcome.failure.code : outcome.failure.kind,
          });
    default:
      return text('rejected', { code: 'CLOSED' });
  }
}

function CloseForm({
  row,
  body,
  writer,
  onClosed,
}: {
  row: ReconciliationCollector;
  body: (counted: number, note: string) => CloseBody;
  writer: Writer;
  onClosed: () => void;
}): ReactElement {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [unlocked, setUnlocked] = useState(writer.unlocked);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (): Promise<void> => {
    const amount = parseCountedCash(counted);
    if (amount === null) {
      setMessage(text('countedIssue'));
      return;
    }
    setBusy(true);
    const outcome = await writer.submit(body(amount, note));
    setBusy(false);
    setUnlocked(writer.unlocked);
    setMessage(submitMessage(outcome));
    if (outcome.kind === 'done') onClosed();
  };
  return (
    <View style={{ gap: space.s2 }}>
      <TextInput
        testID={`counted-${row.collectorId}`}
        accessibilityLabel={text('counted')}
        placeholder={text('counted')}
        placeholderTextColor={color.textMuted}
        keyboardType="number-pad"
        value={counted}
        onChangeText={setCounted}
        editable={!busy}
        style={theme.field}
      />
      <TextInput
        accessibilityLabel={text('note')}
        placeholder={text('note')}
        placeholderTextColor={color.textMuted}
        value={note}
        maxLength={500}
        onChangeText={setNote}
        editable={!busy}
        style={theme.field}
      />
      <PinPanel
        bookingId=""
        writer={writer}
        unlocked={unlocked}
        onUnlocked={() => setUnlocked(true)}
      />
      {message === null ? null : (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={theme.body}>
          {message}
        </Text>
      )}
      <ActionButton
        testID={`close-${row.collectorId}`}
        label={busy ? text('submitting') : text('submit', { name: row.collectorName })}
        disabled={busy || !unlocked}
        onPress={() => void submit()}
      />
    </View>
  );
}

function CollectorCard({
  row,
  closable,
  form,
}: {
  row: ReconciliationCollector;
  closable: boolean;
  form: ReactElement | null;
}): ReactElement {
  return (
    <View style={theme.card} testID={`collector-${row.collectorId}`}>
      <Text style={{ fontWeight: '700', color: color.text }}>{row.collectorName}</Text>
      <Text style={theme.body}>{text('receipts', { count: row.cashReceiptCount })}</Text>
      <Text style={[theme.body, theme.tabular]}>
        {text('expected', { amount: formatVnd(row.expectedCash) })}
      </Text>
      {row.closed === null ? null : (
        <>
          <Text style={[theme.body, theme.tabular]}>
            {text('closed', {
              counted: formatVnd(row.closed.countedCash),
              difference: formatDifference(row.closed.difference),
            })}
          </Text>
          {row.closed.managerNotified ? <Text style={theme.muted}>{text('notified')}</Text> : null}
        </>
      )}
      {closable && row.closed === null ? form : null}
    </View>
  );
}

export function CashScreen(props: CashScreenProps): ReactElement {
  const { session, role, onBack } = props;
  const now = props.now ?? Date.now;
  const businessDate = useMemo(() => businessDateVn(now()), [now]);
  const propertyId = session.selectedProperty();
  const writer = useMemo(() => props.createWriter(), [props.createWriter]);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const closable = canClose(role);

  const refresh = useCallback(async (): Promise<void> => {
    if (propertyId === null) return;
    setLoad({ kind: 'loading' });
    try {
      setLoad({ kind: 'ready', daily: await loadDaily(session, propertyId, businessDate) });
    } catch (caught) {
      setLoad({ kind: 'failed', message: failureText(caught) });
    }
  }, [businessDate, propertyId, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => () => writer.dispose(), [writer]);

  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <Text accessibilityRole="header" style={theme.title}>
        {text('title')}
      </Text>
      <Text style={theme.body}>{text('date', { date: formatBusinessDate(businessDate) })}</Text>
      <Text style={theme.muted}>{closable ? text('hintClose') : text('hintView')}</Text>
      {load.kind === 'loading' ? (
        <ActivityIndicator accessibilityLabel={text('loading')} color={color.primary} />
      ) : null}
      {load.kind === 'failed' ? (
        <Text accessibilityRole="alert" style={theme.alertDanger}>
          {load.message}
        </Text>
      ) : null}
      {load.kind === 'ready' && load.daily.collectors.length === 0 ? (
        <Text style={theme.body}>{text('empty')}</Text>
      ) : null}
      {load.kind === 'ready'
        ? load.daily.collectors.map((row) => (
            <CollectorCard
              key={row.collectorId}
              row={row}
              closable={closable}
              form={
                propertyId === null ? null : (
                  <CloseForm
                    row={row}
                    writer={writer}
                    body={(counted, note) =>
                      closeBodyFor(propertyId, businessDate, row.collectorId, counted, note)
                    }
                    onClosed={() => void refresh()}
                  />
                )
              }
            />
          ))
        : null}
      <ActionButton
        testID="cash-refresh"
        label={text('refresh')}
        tone="plain"
        onPress={() => void refresh()}
      />
      <ActionButton testID="cash-back" label={text('back')} tone="plain" onPress={onBack} />
    </ScrollView>
  );
}
