/**
 * SCR-57 — danh sách khách đến hôm nay (UC-FO-01). Đọc hai tuyến có sẵn qua `ArrivalsReader`; trạng thái
 * rỗng/đang tải/lỗi/ngoại tuyến theo design §8.1 và §8.3. Mở một thẻ để vào SCR-58 (`CheckInDetail`).
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';
import type { BookingSummary } from '@pinehill/contracts';
import { color, space, touchTargetDp, typography } from '@pinehill/ui-native';
import { formatBusinessDate } from '../housekeeping/date';
import type { Session } from '../session';
import { ArrivalCard } from './card';
import { ActionButton } from './controls';
import { CheckInDetail } from './detail';
import { formatVnDateTime } from './format';
import { arrivalsText as text } from './messages';
import { filterArrivals } from './model';
import { GuestNames } from './guest-names';
import { arrivalsPorts, guestPort } from './ports';
import { ArrivalsReader, type ArrivalsCache, type ArrivalsState } from './reader';
import { resolveScan, unavailableScanner, type QrScanner, type ScanResolution } from './scan';
import type { CheckInWriter } from './writer';

export interface ArrivalsScreenProps {
  session: Session;
  /** Cache RAM dùng chung do gốc ứng dụng giữ và xoá khi đăng xuất. */
  cache: ArrivalsCache;
  createWriter: () => CheckInWriter;
  onBack: () => void;
  /** Camera QR; thiếu thì nút Quét báo chưa khả dụng và lễ tân dùng ô tìm theo mã. */
  scanner?: QrScanner;
  onCollectBalance?: (booking: BookingSummary) => void;
  onNoShow?: (booking: BookingSummary) => void;
  /** Mở luồng tạo booking khách vãng lai (SCR-65); thiếu thì không hiện nút. */
  onWalkIn?: () => void;
}

const IDLE_STATE: ArrivalsState = {
  phase: 'idle',
  arrivals: [],
  rooms: [],
  date: null,
  syncedAt: null,
  stale: false,
  notice: null,
  truncated: false,
};

function scanMessage(resolution: ScanResolution): string | null {
  switch (resolution.kind) {
    case 'denied':
      return text('scanDenied');
    case 'unavailable':
      return text('scanUnavailable');
    case 'invalid':
      return text('scanInvalid');
    case 'cancelled':
      return text('scanCancelled');
    case 'noMatch':
      return text('scanNoMatch', { code: resolution.code });
    case 'match':
      return null;
  }
}

/**
 * Reader + writer + tên khách gắn với vòng đời màn hình; đổi phiên/cơ sở thì bỏ khoá chờ và tên đã đọc
 * (PII chỉ ở RAM) rồi tải lại cho ngữ cảnh mới. Tên đọc theo id mỗi khi danh sách có dữ liệu mới.
 */
function useArrivals(
  session: Session,
  cache: ArrivalsCache,
  createWriter: () => CheckInWriter,
  onReset: () => void,
) {
  const [reader, setReader] = useState<ArrivalsReader | null>(null);
  const [writer, setWriter] = useState<CheckInWriter | null>(null);
  const [state, setState] = useState<ArrivalsState>(IDLE_STATE);
  const [names, setNames] = useState<GuestNames | null>(null);
  const [nameVersion, setNameVersion] = useState(0);
  useEffect(() => {
    const activeReader = new ArrivalsReader(arrivalsPorts(session), cache);
    const activeWriter = createWriter();
    const activeNames = new GuestNames(guestPort(session));
    setReader(activeReader);
    setWriter(activeWriter);
    setNames(activeNames);
    setState(activeReader.state);
    const unsubscribeNames = activeNames.subscribe(() => {
      setNameVersion((version) => version + 1);
    });
    const unsubscribe = activeReader.subscribe(() => {
      setState(activeReader.state);
      void activeNames.ensure(activeReader.state.arrivals.map((booking) => booking.guestId));
    });
    const sessionChanges = session.subscribe(() => {
      activeWriter.reset();
      activeNames.clear();
      activeReader.invalidate();
      onReset();
      if (session.hasAccessToken()) void activeReader.load(session.selectedProperty() ?? undefined);
    });
    void activeReader.load(session.selectedProperty() ?? undefined);
    return () => {
      unsubscribe();
      unsubscribeNames();
      sessionChanges();
      activeReader.dispose();
      activeWriter.dispose();
      activeNames.dispose();
    };
  }, [session, cache, createWriter, onReset]);
  const reload = (): void => {
    void reader?.load(session.selectedProperty() ?? undefined);
  };
  return { writer, state, reload, names, nameVersion };
}

function SyncInfo({ state }: { state: ArrivalsState }): ReactElement {
  const stamp = state.syncedAt === null ? null : formatVnDateTime(state.syncedAt);
  const stale = state.stale && stamp !== null;
  return (
    <>
      {state.date === null ? null : (
        <Text style={{ color: color.textMuted }}>
          {text('date', { date: formatBusinessDate(state.date) })}
        </Text>
      )}
      {stamp !== null && !stale ? (
        <Text testID="arrivals-synced" style={{ color: color.textMuted }}>
          {text('synced', { time: stamp })}
        </Text>
      ) : null}
      {stale ? (
        <Text
          testID="arrivals-stale"
          accessibilityLiveRegion="polite"
          style={{ color: color.warning }}
        >
          {text(state.notice === 'offline' ? 'staleOffline' : 'staleError', { time: stamp })}
        </Text>
      ) : null}
    </>
  );
}

function Notice({ id, message }: { id: string; message: string | null }): ReactElement | null {
  if (message === null) return null;
  return (
    <Text testID={id} accessibilityLiveRegion="polite" style={{ color: color.textMuted }}>
      {message}
    </Text>
  );
}

/** Thông điệp trạng thái: chỉ khi chưa có dòng nào để hiện, để không che dữ liệu cũ khi làm mới/lỗi. */
function stateMessage(state: ArrivalsState): string | null {
  if (state.arrivals.length > 0) return null;
  return text(state.phase === 'ready' ? 'ready' : state.phase);
}

function useScan(
  scanner: QrScanner,
  arrivals: readonly BookingSummary[],
  open: (booking: BookingSummary) => void,
  setTerm: (term: string) => void,
) {
  const [notice, setNotice] = useState<string | null>(null);
  const scan = async (): Promise<void> => {
    const resolution = await resolveScan(scanner, arrivals);
    if (resolution.kind === 'match') {
      setNotice(null);
      setTerm('');
      open(resolution.booking);
      return;
    }
    if (resolution.kind === 'noMatch') setTerm(resolution.code);
    setNotice(scanMessage(resolution));
  };
  return { notice, scan };
}

export function ArrivalsScreen({
  session,
  cache,
  createWriter,
  onBack,
  scanner = unavailableScanner,
  onCollectBalance,
  onNoShow,
  onWalkIn,
}: ArrivalsScreenProps): ReactElement {
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<BookingSummary | null>(null);
  const closeDetail = useCallback(() => {
    setSelected(null);
  }, []);
  const { writer, state, reload, names, nameVersion } = useArrivals(
    session,
    cache,
    createWriter,
    closeDetail,
  );
  const { notice, scan } = useScan(scanner, state.arrivals, setSelected, setTerm);

  if (selected !== null && writer !== null)
    return (
      <CheckInDetail
        booking={selected}
        rooms={state.rooms}
        writer={writer}
        onChanged={reload}
        onClose={closeDetail}
        {...(onCollectBalance === undefined ? {} : { onCollectBalance })}
        {...(onNoShow === undefined ? {} : { onNoShow })}
      />
    );

  const rows = filterArrivals(state.arrivals, term);
  const loading = state.phase === 'loading';
  return (
    <View style={{ flex: 1, padding: space.s4, gap: space.s3, backgroundColor: color.surface }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}
      >
        {text('title')}
      </Text>
      <SyncInfo state={state} />
      <TextInput
        testID="arrivals-filter"
        accessibilityLabel={text('filter')}
        placeholder={text('filter')}
        value={term}
        autoCapitalize="characters"
        autoCorrect={false}
        onChangeText={setTerm}
        style={{
          minHeight: touchTargetDp,
          paddingHorizontal: space.s3,
          borderWidth: 1,
          borderRadius: 8,
          color: color.text,
        }}
      />
      {loading ? <ActivityIndicator accessibilityLabel={text('loading')} /> : null}
      <Notice id="arrivals-state" message={stateMessage(state)} />
      <Notice id="arrivals-truncated" message={state.truncated ? text('truncated') : null} />
      <Notice id="arrivals-scan-notice" message={notice} />
      <Notice
        id="arrivals-no-match"
        message={state.arrivals.length > 0 && rows.length === 0 ? text('noFilterMatch') : null}
      />
      <FlatList<BookingSummary>
        testID="arrivals-list"
        accessibilityLabel={text('ready')}
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ gap: space.s3 }}
        extraData={nameVersion}
        renderItem={({ item }) => (
          <ArrivalCard
            booking={item}
            guestName={names?.get(item.guestId) ?? null}
            onOpen={setSelected}
          />
        )}
      />
      <Actions
        loading={loading}
        onScan={() => void scan()}
        onRefresh={reload}
        onWalkIn={onWalkIn}
        onBack={onBack}
      />
    </View>
  );
}

function Actions({
  loading,
  onScan,
  onRefresh,
  onWalkIn,
  onBack,
}: {
  loading: boolean;
  onScan: () => void;
  onRefresh: () => void;
  onWalkIn: (() => void) | undefined;
  onBack: () => void;
}): ReactElement {
  return (
    <View style={{ gap: space.s2 }}>
      <ActionButton testID="arrivals-scan" label={text('scan')} onPress={onScan} />
      {onWalkIn === undefined ? null : (
        <ActionButton testID="arrivals-walk-in" label={text('walkIn')} onPress={onWalkIn} />
      )}
      <ActionButton
        testID="arrivals-refresh"
        label={text('refresh')}
        tone="plain"
        disabled={loading}
        onPress={onRefresh}
      />
      <ActionButton testID="arrivals-back" label={text('back')} tone="plain" onPress={onBack} />
    </View>
  );
}
