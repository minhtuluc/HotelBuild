/**
 * SCR-67 — cảnh báo quá tải. Quản lý/chủ chuỗi đọc ca theo phạm vi; lễ tân chỉ thấy cảnh báo tối thiểu theo
 * booking được cấp. Trạng thái rỗng chỉ khi lượt quét thành công có mốc; chưa quét/lỗi là "chưa xác định".
 */
import { useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import type { UserMe } from '@pinehill/contracts';
import { color, space, typography } from '@pinehill/ui-native';
import { ActionButton } from '../../arrivals/controls';
import { formatVnDateTime } from '../../arrivals/format';
import type { Session } from '../../session';
import { f6Text as text } from './messages';
import { emptyConfirmed, type AlertRow } from './model';
import { f6Ports } from './ports';
import { AlertsCache, AlertsReader, IDLE_ALERTS, type AlertsState } from './reader';

export interface AlertsScreenProps {
  session: Session;
  profile: UserMe;
  cache: AlertsCache;
  online: () => Promise<boolean>;
  createId: () => string;
  onBack: () => void;
  /** Mở SCR-63; lễ tân kèm booking đang xử lý. */
  onOpen: (caseId: string, booking: AlertRow['bookings'][number] | null) => void;
}

function useAlerts(props: AlertsScreenProps) {
  const { session, profile, cache, online, createId } = props;
  const [reader, setReader] = useState<AlertsReader | null>(null);
  const [state, setState] = useState<AlertsState>(IDLE_ALERTS);
  useEffect(() => {
    const active = new AlertsReader(f6Ports(session, { online, createId }), cache);
    setReader(active);
    const unsubscribe = active.subscribe(() => {
      setState(active.state);
    });
    // Đổi phiên/cơ sở: bỏ dữ liệu cũ rồi tải lại cho ngữ cảnh mới; mất token thì không tải.
    const sessionChanges = session.subscribe(() => {
      active.invalidate();
      if (session.hasAccessToken())
        void active.load(profile.role, session.selectedProperty() ?? undefined);
    });
    void active.load(profile.role, session.selectedProperty() ?? undefined);
    return () => {
      unsubscribe();
      sessionChanges();
      active.dispose();
    };
  }, [session, profile.role, cache, online, createId]);
  const reload = (): void => {
    void reader?.load(profile.role, session.selectedProperty() ?? undefined);
  };
  return { state, reload };
}

function scanLine(state: AlertsState): string {
  const scan = state.scan;
  if (scan === null) return '';
  const at = scan.lastSuccessAt === null ? text('never') : formatVnDateTime(scan.lastSuccessAt);
  if (scan.status === 'SUCCEEDED' || (scan.status === 'RUNNING' && scan.lastSuccessAt !== null))
    return text('scanOk', { time: at });
  return scan.status === 'FAILED' ? text('scanFailed', { time: at }) : text('scanUnknown');
}

function Freshness({ state }: { state: AlertsState }): ReactElement {
  const stamp = state.syncedAt === null ? null : formatVnDateTime(state.syncedAt);
  return (
    <>
      {state.scan === null ? null : (
        <Text
          testID="alerts-scan"
          accessibilityLiveRegion="polite"
          style={{ color: state.scan.status === 'SUCCEEDED' ? color.textMuted : color.warning }}
        >
          {scanLine(state)}
        </Text>
      )}
      {state.overdueCount === null ? null : (
        <Text testID="alerts-overdue-count" style={{ color: color.textMuted }}>
          {text('overdueCount', { count: state.overdueCount })}
        </Text>
      )}
      {state.stale && stamp !== null ? (
        <Text
          testID="alerts-stale"
          accessibilityLiveRegion="polite"
          style={{ color: color.warning }}
        >
          {text(state.notice === 'offline' ? 'staleOffline' : 'staleError', { time: stamp })}
        </Text>
      ) : null}
    </>
  );
}

/** Lễ tân nhận `label` máy chủ dựng (HB-221); quản lý nhận ca đủ trường để tự ghép câu. */
function headline(row: AlertRow): string {
  if (row.label !== null) return row.label;
  return text('caseLine', { date: row.date, type: row.typeLabel ?? '—', count: row.shortage ?? 0 });
}

function dueLine(row: AlertRow): string {
  const state = row.overdue ? text('overdue') : text('inTime');
  if (row.deadline === null) return state;
  return `${text('deadline', { time: formatVnDateTime(row.deadline) })} · ${state}`;
}

function AlertCard({
  row,
  onOpen,
}: {
  row: AlertRow;
  onOpen: AlertsScreenProps['onOpen'];
}): ReactElement {
  const label = (extra: string): string => `${text('open')} ${extra}`.trim();
  return (
    <View
      testID={`alert-${row.caseId}`}
      accessible
      style={{
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: 8,
        padding: space.s3,
        gap: space.s2,
      }}
    >
      <Text style={{ fontWeight: '700', color: color.text }}>{headline(row)}</Text>
      <Text>{text('statusLabel', { status: row.status })}</Text>
      <Text style={{ color: row.overdue ? color.danger : color.textMuted }}>{dueLine(row)}</Text>
      {row.escalatedAt === null ? null : (
        <Text>{text('escalatedAt', { time: formatVnDateTime(row.escalatedAt) })}</Text>
      )}
      {row.delayReason === null ? null : (
        <Text>{text('delayReason', { reason: row.delayReason })}</Text>
      )}
      {row.bookings.length === 0 ? (
        <ActionButton
          testID={`open-${row.caseId}`}
          label={label('')}
          onPress={() => onOpen(row.caseId, null)}
        />
      ) : (
        row.bookings.map((booking, index) => (
          <ActionButton
            key={booking.bookingId}
            testID={`open-${row.caseId}-${booking.bookingId}`}
            label={label(
              booking.guest === '' ? text('bookingOrdinal', { n: index + 1 }) : booking.guest,
            )}
            onPress={() => onOpen(row.caseId, booking)}
          />
        ))
      )}
    </View>
  );
}

function emptyMessage(state: AlertsState): string {
  const scan = state.scan;
  if (scan === null || !emptyConfirmed(scan)) return text('notConfirmedEmpty');
  const at = scan.lastSuccessAt;
  return text('confirmedEmpty', { time: at === null ? '—' : formatVnDateTime(at) });
}

/** Thông điệp trạng thái: chỉ khi chưa có dòng nào, để không che dữ liệu cũ khi làm mới/lỗi. */
function Message({ state }: { state: AlertsState }): ReactElement | null {
  if (state.rows.length > 0 || state.phase === 'idle') return null;
  const message =
    state.phase === 'empty'
      ? emptyMessage(state)
      : text(state.phase === 'ready' ? 'ready' : state.phase);
  return (
    <Text
      testID="alerts-message"
      accessibilityLiveRegion="polite"
      style={{ color: color.textMuted }}
    >
      {message}
    </Text>
  );
}

export function AlertsScreen(props: AlertsScreenProps): ReactElement {
  const { state, reload } = useAlerts(props);
  return (
    <View style={{ flex: 1, padding: space.s4, gap: space.s3 }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}
      >
        {text('alertsTitle')}
      </Text>
      <Text style={{ color: color.textMuted }}>{text('alertsHint')}</Text>
      <ActionButton
        testID="alerts-refresh"
        label={text('refresh')}
        onPress={reload}
        disabled={state.phase === 'loading'}
      />
      {state.phase === 'loading' ? (
        <ActivityIndicator accessibilityLabel={text('loading')} />
      ) : null}
      <Freshness state={state} />
      <Message state={state} />
      <FlatList
        data={[...state.rows]}
        keyExtractor={(row: AlertRow) => row.caseId}
        renderItem={({ item }: { item: AlertRow }) => (
          <AlertCard row={item} onOpen={props.onOpen} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.s3 }} />}
      />
      <ActionButton testID="alerts-back" tone="plain" label={text('back')} onPress={props.onBack} />
    </View>
  );
}
