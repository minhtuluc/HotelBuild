import { Children, isValidElement, type ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';
import { TaskReader } from '../src/housekeeping/reader';
import { HousekeepingReadScreen } from '../src/housekeeping/screen';
import { TaskWriter } from '../src/housekeeping/writer';
import { taskWritePorts } from '../src/housekeeping/write-ports';

const hooks = vi.hoisted(() => ({ values: new Array<unknown>(), index: 0, setDate: vi.fn() }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: () => {},
  useState: () => [hooks.values[hooks.index++], hooks.setDate],
}));
// Only native host primitives/hooks are substituted. The screen's input callback and Reader run.
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
function dateInput(node: ReactNode): ((date: string) => void) | undefined {
  if (
    !isValidElement<{ children?: ReactNode; testID?: string; onChangeText?: (v: string) => void }>(
      node,
    )
  )
    return;
  if (node.props.testID === 'task-business-date') return node.props.onChangeText;
  for (const child of Children.toArray(node.props.children)) {
    const handler = dateInput(child);
    if (handler) return handler;
  }
  return undefined;
}
test.each(['2026-11-02', 'invalid'])(
  'actual date input %s immediately removes prior tasks without HTTP',
  async (date) => {
    const read = vi.fn(async () => ({
      data: [
        {
          id: 't1',
          roomId: 'r1',
          roomCode: '101',
          businessDate: '2026-11-01',
          status: 'PENDING' as const,
          assignedTo: 'u1',
          note: null,
          completedAt: null,
          version: 1,
        },
      ],
      meta: { limit: 100, total: 1, hasMore: false, nextCursor: null },
    }));
    const reader = new TaskReader({
      actor: async () => ({
        userId: 'u1',
        username: 'synthetic',
        fullName: 'Synthetic',
        role: 'HOUSEKEEPING',
        propertyScope: ['p1'],
        hasPin: true,
        mustChangePassword: false,
      }),
      read,
    });
    await reader.load('2026-11-01', 'p1');
    expect(reader.state.phase).toBe('ready');
    hooks.index = 0;
    hooks.values = [reader, reader.state, '2026-11-01'];
    hooks.setDate.mockClear();
    const session = new Session({
      storage: memoryStorage(),
      baseUrl: 'https://synthetic.test/api/v1',
      createId: () => 'synthetic',
      netInfo: { getConnected: async () => true },
    });
    try {
      const change = dateInput(
        HousekeepingReadScreen({
          session,
          onBack: () => {},
          createWriter: () =>
            new TaskWriter({
              ...taskWritePorts(session),
              storage: memoryStorage(),
              createId: () => '00000000-0000-4000-8000-000000000001',
              now: () => 1793491200000,
            }),
        }),
      );
      expect(change).toBeTypeOf('function');
      change?.(date);
      expect(hooks.setDate).toHaveBeenCalledWith(date);
      expect(reader.state).toEqual({ phase: 'idle', tasks: [] });
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      reader.dispose();
    }
  },
);
