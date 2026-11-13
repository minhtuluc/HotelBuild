import { useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { color } from '@pinehill/ui-native';
import type { Session } from '../session';
import { theme } from '../theme';
import { TaskReader, todayVN, type TaskState } from './reader';
import { taskPorts } from './ports';
import { taskText as text } from './messages';
import type { TaskWriter } from './writer';
import { TaskWorkspace } from './workspace';
export function HousekeepingReadScreen({
  session,
  onBack,
  createWriter,
}: {
  session: Session;
  onBack: () => void;
  createWriter: () => TaskWriter;
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
    <View style={theme.screen}>
      <Text accessibilityRole="header" style={theme.title}>
        {text('title')}
      </Text>
      <Text style={theme.body}>{text('date')}</Text>
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
        style={theme.field}
      />
      <Pressable
        testID="task-load"
        accessibilityRole="button"
        accessibilityLabel={text('load')}
        accessibilityState={{ disabled: loading }}
        disabled={loading}
        onPress={() => void reader?.load(date, session.selectedProperty() ?? undefined)}
        style={theme.buttonPrimary}
      >
        <Text style={theme.buttonPrimaryText}>{text('load')}</Text>
      </Pressable>
      {loading ? (
        <ActivityIndicator accessibilityLabel={text('loading')} color={color.primary} />
      ) : null}
      {state.phase === 'ready' ? null : (
        <Text accessibilityLiveRegion="polite" testID="task-state" style={theme.muted}>
          {text(state.phase)}
        </Text>
      )}
      <TaskWorkspace
        session={session}
        reader={reader}
        tasks={state.tasks}
        createWriter={createWriter}
      />
      <Pressable
        testID="task-back"
        accessibilityRole="button"
        accessibilityLabel={text('back')}
        onPress={onBack}
        style={theme.buttonPlain}
      >
        <Text style={theme.buttonPlainText}>{text('back')}</Text>
      </Pressable>
    </View>
  );
}
