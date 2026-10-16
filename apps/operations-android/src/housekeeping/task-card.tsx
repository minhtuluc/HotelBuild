import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { color, space, touchTargetDp } from '@pinehill/ui-native';
import type { HousekeepingTask } from '@pinehill/contracts';
import { formatBusinessDate } from './date';
import type { TaskTarget } from './intent';
import { taskText as text, statusText } from './messages';
import { writeText } from './write-messages';
export interface TaskCardProps {
  task: HousekeepingTask;
  disabled: boolean;
  onRequest(target: TaskTarget): Promise<void>;
}
export function TaskCard({ task, disabled, onRequest }: TaskCardProps): ReactElement {
  return (
    <View
      testID={'housekeeping-task-' + task.id}
      style={{ padding: space.s3, gap: space.s2, borderWidth: 1, borderRadius: 8 }}
    >
      <Text accessibilityRole="header" style={{ color: color.text, fontWeight: '700' }}>
        {text('room', { code: task.roomCode })}
      </Text>
      <Text>{formatBusinessDate(task.businessDate)}</Text>
      <Text>{statusText(task.status)}</Text>
      {task.note ? <Text>{task.note}</Text> : null}
      <Pressable
        testID={'task-start-' + task.id}
        accessibilityRole="button"
        accessibilityLabel={writeText('start', { code: task.roomCode })}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          void onRequest('IN_PROGRESS');
        }}
        style={{
          minHeight: touchTargetDp,
          justifyContent: 'center',
          padding: space.s2,
          borderWidth: 1,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: color.primary }}>{writeText('start', { code: task.roomCode })}</Text>
      </Pressable>
      <Pressable
        testID={'task-done-' + task.id}
        accessibilityRole="button"
        accessibilityLabel={writeText('done', { code: task.roomCode })}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          void onRequest('DONE');
        }}
        style={{
          minHeight: touchTargetDp,
          justifyContent: 'center',
          padding: space.s2,
          borderWidth: 1,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: color.primary }}>{writeText('done', { code: task.roomCode })}</Text>
      </Pressable>
    </View>
  );
}
