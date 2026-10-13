import { useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { color, space, touchTargetDp, typography } from '@pinehill/ui-native';
import type { HousekeepingTask } from '@pinehill/contracts';
import type { Session } from '../session';
import { TaskReader, todayVN, type TaskState } from './reader';
import { taskPorts } from './ports';
import { taskText as text, statusText } from './messages';
export function HousekeepingReadScreen({
  session,
  onBack,
}: {
  session: Session;
  onBack: () => void;
}): ReactElement {
  const [reader, setReader] = useState<TaskReader | null>(null);
  const [state, setState] = useState<TaskState>({ phase: 'idle', tasks: [] });
  const [date, setDate] = useState(() => todayVN(new Date()));
  useEffect(() => {
    const active = new TaskReader(taskPorts(session));
    setReader(active);
    setState(active.state);
    const unsubscribe = active.subscribe(() => setState(active.state));
    const sessionChanges = session.subscribe(() => active.invalidate());
    void active.load(date, session.selectedProperty() ?? undefined);
    return () => {
      unsubscribe();
      sessionChanges();
      active.dispose();
    };
  }, [session]);
  const loading = state.phase === 'loading' || reader === null;
  return (
    <View style={{ flex: 1, padding: space.s4, gap: space.s3, backgroundColor: color.surface }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}
      >
        {text('title')}
      </Text>
      <Text>{text('date')}</Text>
      <TextInput
        testID="task-business-date"
        accessibilityLabel={text('date')}
        value={date}
        maxLength={10}
        autoCapitalize="none"
        editable={!loading}
        onChangeText={(value) => {
          reader?.invalidate();
          setDate(value);
        }}
        style={{
          minHeight: touchTargetDp,
          paddingHorizontal: space.s3,
          borderWidth: 1,
          borderRadius: 8,
          color: color.text,
        }}
      />
      <Pressable
        testID="task-load"
        accessibilityRole="button"
        accessibilityLabel={text('load')}
        accessibilityState={{ disabled: loading }}
        disabled={loading}
        onPress={() => void reader?.load(date, session.selectedProperty() ?? undefined)}
        style={{
          minHeight: touchTargetDp,
          justifyContent: 'center',
          paddingHorizontal: space.s3,
          backgroundColor: color.primary,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: color.surface, textAlign: 'center', fontWeight: '600' }}>
          {text('load')}
        </Text>
      </Pressable>
      {loading ? <ActivityIndicator accessibilityLabel={text('loading')} /> : null}
      {state.phase === 'ready' ? null : (
        <Text
          accessibilityLiveRegion="polite"
          testID="task-state"
          style={{ color: color.textMuted }}
        >
          {text(state.phase)}
        </Text>
      )}
      <FlatList
        testID="task-list"
        accessibilityLabel={text('assigned')}
        data={state.tasks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TaskCard task={item} />}
        contentContainerStyle={{ gap: space.s3 }}
      />
      <Pressable
        testID="task-back"
        accessibilityRole="button"
        accessibilityLabel={text('back')}
        onPress={onBack}
        style={{ minHeight: touchTargetDp, justifyContent: 'center', paddingHorizontal: space.s3 }}
      >
        <Text style={{ color: color.primary }}>{text('back')}</Text>
      </Pressable>
    </View>
  );
}
function TaskCard({ task }: { task: HousekeepingTask }): ReactElement {
  return (
    <View
      testID={'housekeeping-task-' + task.id}
      style={{ padding: space.s3, gap: space.s2, borderWidth: 1, borderRadius: 8 }}
    >
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {text('room', { code: task.roomCode })}
      </Text>
      <Text>{task.businessDate}</Text>
      <Text>{statusText(task.status)}</Text>
      {task.note ? <Text>{task.note}</Text> : null}
    </View>
  );
}
