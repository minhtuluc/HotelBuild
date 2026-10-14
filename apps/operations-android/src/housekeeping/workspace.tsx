import { useEffect, useState, type ReactElement } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { color, space, touchTargetDp } from '@pinehill/ui-native';
import type { HousekeepingTask } from '@pinehill/contracts';
import type { Session } from '../session';
import type { TaskReader } from './reader';
import type { TaskTarget } from './intent';
import { TaskWriter, type TaskWritePhase } from './writer';
import { TaskCard } from './task-card';
import { taskText } from './messages';
import { phaseText, writeText } from './write-messages';
interface Props {
  session: Session;
  reader: TaskReader | null;
  tasks: readonly HousekeepingTask[];
  createWriter(): TaskWriter;
}
export function TaskWorkspace({ session, reader, tasks, createWriter }: Props): ReactElement {
  const [writer, setWriter] = useState<TaskWriter | null>(null);
  const [phase, setPhase] = useState<TaskWritePhase>('idle');
  useEffect(() => {
    if (!reader) return;
    const active = createWriter();
    setWriter(active);
    setPhase(active.state.phase);
    const unsubscribe = active.subscribe(() => {
      const next = active.state.phase;
      setPhase(next);
      if (
        [
          'saved',
          'unknown',
          'conflict',
          'rejected',
          'expired',
          'forbidden',
          'needsReview',
        ].includes(next)
      )
        reader.invalidate();
    });
    void active.restore();
    return () => {
      unsubscribe();
      active.dispose();
    };
  }, [session, reader, createWriter]);
  function request(task: HousekeepingTask, target: TaskTarget): Promise<void> {
    if (!writer?.canStart) return Promise.resolve();
    reader?.invalidate();
    return writer.start(task, target);
  }
  return (
    <View style={{ flex: 1, gap: space.s2 }}>
      <Text
        testID="task-write-state"
        accessibilityLiveRegion="polite"
        style={{ color: color.textMuted }}
      >
        {phaseText(phase)}
      </Text>
      <Pressable
        testID="task-write-inspect"
        accessibilityRole="button"
        accessibilityLabel={writeText('inspect')}
        accessibilityState={{ disabled: writer === null || writer.busy }}
        disabled={writer === null || writer.busy}
        onPress={() => {
          void writer?.restore();
        }}
        style={{ minHeight: touchTargetDp, justifyContent: 'center', padding: space.s2 }}
      >
        <Text style={{ color: color.primary }}>{writeText('inspect')}</Text>
      </Pressable>
      {writer?.canRetry ? (
        <Pressable
          testID="task-write-retry"
          accessibilityRole="button"
          accessibilityLabel={writeText('retry')}
          accessibilityState={{ disabled: writer.busy }}
          disabled={writer.busy}
          onPress={() => {
            void writer.retry();
          }}
          style={{ minHeight: touchTargetDp, justifyContent: 'center', padding: space.s2 }}
        >
          <Text style={{ color: color.primary }}>{writeText('retry')}</Text>
        </Pressable>
      ) : null}
      <FlatList
        testID="task-list"
        accessibilityLabel={taskText('assigned')}
        data={tasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: space.s3 }}
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            disabled={!writer?.canStart}
            onRequest={(target) => request(item, target)}
          />
        )}
      />
    </View>
  );
}
