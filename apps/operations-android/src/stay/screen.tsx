/**
 * SCR-60 — danh sách khách đi hôm nay (UC-FO-02), điểm vào SCR-61 (trả phòng) và SCR-59 (thu số dư).
 * Trạng thái rỗng/đang tải/lỗi/ngoại tuyến theo design §8.1: danh sách cũ chỉ giữ trong RAM của màn hình.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';
import type { BookingSummary, CheckOutResponse, Payment } from '@pinehill/contracts';
import { color, space, touchTargetDp, typography } from '@pinehill/ui-native';
import { ActionButton } from '../arrivals/controls';
import { formatVnDateTime } from '../arrivals/format';
import { filterArrivals } from '../arrivals/model';
import { formatBusinessDate } from '../housekeeping/date';
import type { Session } from '../session';
import { DepartureCard } from './card';
import { CheckOutDetail } from './checkout';
import { watchContext } from './context';
import { CollectScreen } from './collect';
import { stayText as text } from './messages';
import type { CheckOutBody, CollectBody } from './model';
import { departuresPorts } from './ports';
import { DeparturesReader, type DeparturesState } from './reader';
import type { PinnedWriter } from './writer';

export interface DeparturesScreenProps {
  session: Session;
  createCheckOutWriter: () => PinnedWriter<CheckOutBody, CheckOutResponse>;
  createCollectWriter: () => PinnedWriter<CollectBody, Payment>;
  onBack: () => void;
}

const IDLE_STATE: DeparturesState = {
  phase: 'idle',
  departures: [],
  date: null,
  syncedAt: null,
  stale: false,
  notice: null,
  truncated: false,
};

type DeparturesView =
  | { readonly kind: 'list' }
  | { readonly kind: 'checkout'; readonly booking: BookingSummary }
  | { readonly kind: 'collect'; readonly booking: BookingSummary };

/** Reader gắn với vòng đời màn hình; đổi phiên/cơ sở thì về danh sách và tải lại cho ngữ cảnh mới. */
function useDepartures(session: Session, onReset: () => void) {
  const [reader, setReader] = useState<DeparturesReader | null>(null);
  const [state, setState] = useState<DeparturesState>(IDLE_STATE);
  useEffect(() => {
    const active = new DeparturesReader(departuresPorts(session));
    setReader(active);
    setState(active.state);
    const unsubscribe = active.subscribe(() => setState(active.state));
    const sessionChanges = watchContext(session, () => {
      active.invalidate();
      onReset();
      if (session.hasAccessToken()) void active.load(session.selectedProperty() ?? undefined);
    });
    void active.load(session.selectedProperty() ?? undefined);
    return () => {
      unsubscribe();
      sessionChanges();
      active.dispose();
    };
  }, [session, onReset]);
  const reload = useCallback((): void => {
    void reader?.load(session.selectedProperty() ?? undefined);
  }, [reader, session]);
  return { state, reload };
}

function SyncInfo({ state }: { state: DeparturesState }): ReactElement {
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
        <Text testID="departures-synced" style={{ color: color.textMuted }}>
          {text('synced', { time: stamp })}
        </Text>
      ) : null}
      {stale ? (
        <Text
          testID="departures-stale"
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

function stateMessage(state: DeparturesState): string | null {
  if (state.departures.length > 0) return null;
  return text(state.phase === 'ready' ? 'ready' : state.phase);
}

export function DeparturesScreen({
  session,
  createCheckOutWriter,
  createCollectWriter,
  onBack,
}: DeparturesScreenProps): ReactElement {
  const [term, setTerm] = useState('');
  const [view, setView] = useState<DeparturesView>({ kind: 'list' });
  const toList = useCallback(() => {
    setView({ kind: 'list' });
  }, []);
  const { state, reload } = useDepartures(session, toList);

  if (view.kind === 'checkout')
    return (
      <CheckOutDetail
        session={session}
        booking={view.booking}
        date={state.date ?? ''}
        createWriter={createCheckOutWriter}
        onChanged={reload}
        onClose={toList}
        onCollectBalance={(booking) => {
          setView({ kind: 'collect', booking });
        }}
      />
    );
  if (view.kind === 'collect')
    return (
      <CollectScreen
        session={session}
        booking={view.booking}
        createWriter={createCollectWriter}
        onClose={() => {
          toList();
          reload();
        }}
      />
    );

  const rows = filterArrivals(state.departures, term);
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
        testID="departures-filter"
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
      <Notice id="departures-state" message={stateMessage(state)} />
      <Notice id="departures-truncated" message={state.truncated ? text('truncated') : null} />
      <Notice
        id="departures-no-match"
        message={state.departures.length > 0 && rows.length === 0 ? text('noFilterMatch') : null}
      />
      <FlatList<BookingSummary>
        testID="departures-list"
        accessibilityLabel={text('ready')}
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ gap: space.s3 }}
        renderItem={({ item }) => (
          <DepartureCard
            booking={item}
            date={state.date}
            onOpen={(booking) => {
              setView({ kind: 'checkout', booking });
            }}
          />
        )}
      />
      <View style={{ gap: space.s2 }}>
        <ActionButton
          testID="departures-refresh"
          label={text('refresh')}
          tone="plain"
          disabled={loading}
          onPress={reload}
        />
        <ActionButton testID="departures-back" label={text('back')} tone="plain" onPress={onBack} />
      </View>
    </View>
  );
}
