import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { HousekeepingTask } from '@pinehill/contracts';
import { expect, test, vi } from 'vitest';
import { TaskWorkspace } from '../src/housekeeping/workspace';
import { TaskCard, type TaskCardProps } from '../src/housekeeping/task-card';
import { TaskReader } from '../src/housekeeping/reader';
import { taskPorts } from '../src/housekeeping/ports';
import { setup, task } from './task-write-fixture';
import type { TaskWriter } from '../src/housekeeping/writer';
const hooks = vi.hoisted(() => ({ values: new Array<unknown>(), index: 0 }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: () => {},
  useState: () => [hooks.values[hooks.index++], () => {}],
}));
vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
}));
interface Props {
  children?: ReactNode;
  testID?: string;
  disabled?: boolean;
  onPress?: () => Promise<void> | void;
  renderItem?: (args: { item: HousekeepingTask }) => ReactElement<TaskCardProps>;
}
function find(node: ReactNode, id: string): ReactElement<Props> | undefined {
  if (!isValidElement<Props>(node)) return;
  if (node.props.testID === id) return node;
  for (const child of Children.toArray(node.props.children)) {
    const result = find(child, id);
    if (result) return result;
  }
  return undefined;
}
async function harness() {
  const t = await setup(),
    reader = new TaskReader(taskPorts(t.session));
  await reader.load(task.businessDate, t.session.selectedProperty() ?? undefined);
  const render = () => {
    hooks.index = 0;
    hooks.values = [t.writer, t.writer.state.phase];
    return TaskWorkspace({
      session: t.session,
      reader,
      tasks: reader.state.tasks,
      createWriter: t.makeWriter,
    });
  };
  const card = () => {
    const row = find(render(), 'task-list')?.props.renderItem?.({ item: task });
    if (!row) throw Error('Missing actual task row');
    return TaskCard(row.props);
  };
  const cleanup = () => {
    reader.dispose();
    t.writer.dispose();
  };
  return { ...t, reader, render, card, cleanup };
}
async function press(node: ReactElement<Props> | undefined, writer: TaskWriter): Promise<void> {
  expect(node).toBeDefined();
  const done = Promise.withResolvers<void>();
  const stop = writer.subscribe(() => {
    if (!writer.busy) done.resolve();
  });
  try {
    void node?.props.onPress?.();
    if (!writer.busy) done.resolve();
    await done.promise;
  } finally {
    stop();
  }
}
test('actual task start callback invalidates stale list and uses the real Writer/Session', async () => {
  const t = await harness();
  try {
    expect(t.reader.state.phase).toBe('ready');
    const button = find(t.card(), 'task-start-' + task.id);
    expect(button?.props.disabled).toBe(false);
    await press(button, t.writer);
    expect(t.reader.state.tasks).toEqual([]);
    expect(t.s.writes[0]?.body).toBe('{"status":"IN_PROGRESS"}');
    expect(t.writer.state.phase).toBe('saved');
  } finally {
    t.cleanup();
  }
});
test('fresh GET facts cannot unlock uncertain writes; the actual retry callback keeps exact request bytes', async () => {
  const t = await harness();
  try {
    t.s.response = async () => {
      throw Error('synthetic lost acknowledgement');
    };
    await press(find(t.card(), 'task-start-' + task.id), t.writer);
    t.s.rows = [{ ...task, status: 'IN_PROGRESS', version: 4 }];
    await t.reader.load(task.businessDate, t.session.selectedProperty() ?? undefined);
    expect(t.reader.state.tasks[0]?.status).toBe('IN_PROGRESS');
    expect(find(t.card(), 'task-done-' + task.id)?.props.disabled).toBe(true);
    expect(t.writer.state.phase).toBe('unknown');
    t.s.response = async () =>
      Response.json(
        { ...task, status: 'IN_PROGRESS', version: 4 },
        { headers: { etag: '"4"', 'idempotency-replayed': 'true' } },
      );
    const retry = find(t.render(), 'task-write-retry');
    expect(retry).toBeDefined();
    await press(retry, t.writer);
    expect(t.writer.state.phase).toBe('saved');
    expect(t.s.writes[1]).toEqual(t.s.writes[0]);
  } finally {
    t.cleanup();
  }
});
test('a callback captured by a disposed workspace cannot submit or erase the current reader', async () => {
  const t = await harness();
  try {
    const button = find(t.card(), 'task-start-' + task.id);
    t.writer.dispose();
    await press(button, t.writer);
    expect(t.s.writes).toHaveLength(0);
    expect(t.reader.state.phase).toBe('ready');
  } finally {
    t.cleanup();
  }
});
