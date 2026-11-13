import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { HousekeepingTask } from '@pinehill/contracts';
import { formatBusinessDate } from './date';
import type { TaskTarget } from './intent';
import { taskText as text, statusText } from './messages';
import { theme } from '../theme';
import { writeText } from './write-messages';
export interface TaskCardProps {
  task: HousekeepingTask;
  disabled: boolean;
  onRequest(target: TaskTarget): Promise<void>;
}
export function TaskCard({ task, disabled, onRequest }: TaskCardProps): ReactElement {
  return (
    <View testID={'housekeeping-task-' + task.id} style={theme.card}>
      <Text accessibilityRole="header" style={{ color: theme.body.color, fontWeight: '600' }}>
        {text('room', { code: task.roomCode })}
      </Text>
      <Text style={theme.body}>{formatBusinessDate(task.businessDate)}</Text>
      <Text style={theme.muted}>{statusText(task.status)}</Text>
      {task.note ? <Text style={theme.muted}>{task.note}</Text> : null}
      <Pressable
        testID={'task-start-' + task.id}
        accessibilityRole="button"
        accessibilityLabel={writeText('start', { code: task.roomCode })}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          void onRequest('IN_PROGRESS');
        }}
        style={theme.buttonSecondary}
      >
        <Text style={theme.buttonPlainText}>{writeText('start', { code: task.roomCode })}</Text>
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
        style={theme.buttonSecondary}
      >
        <Text style={theme.buttonPlainText}>{writeText('done', { code: task.roomCode })}</Text>
      </Pressable>
    </View>
  );
}
