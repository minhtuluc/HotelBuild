import { expect, test } from 'vitest';
import type { HousekeepingTask, UserMe } from '@pinehill/contracts';
import { TaskReader, todayVN, type TaskPorts } from '../src/housekeeping/reader';
const actor: UserMe = {
  userId: 'u1',
  username: 'synthetic',
  fullName: 'Synthetic',
  role: 'HOUSEKEEPING',
  propertyScope: ['p1'],
  hasPin: true,
  mustChangePassword: false,
};
const task: HousekeepingTask = {
  id: 't1',
  roomId: 'r1',
  roomCode: '101',
  businessDate: '2026-11-01',
  status: 'PENDING',
  assignedTo: 'u1',
  note: null,
  completedAt: null,
  version: 1,
};
function setup() {
  let current = actor;
  const queries: unknown[] = [];
  const ports: TaskPorts = {
    actor: async () => current,
    read: async (query) => {
      queries.push(query);
      return { data: [task], meta: { limit: 100, total: 1, hasMore: false, nextCursor: null } };
    },
  };
  return {
    reader: new TaskReader(ports),
    ports,
    queries,
    actor: (next: UserMe) => {
      current = next;
    },
  };
}
test('assigned-to actor query yields task-only private DTO after pre/post WHO', async () => {
  const s = setup();
  await s.reader.load('2026-11-01', 'p1');
  expect(s.reader.state.phase).toBe('ready');
  expect(s.reader.state.tasks).toEqual([task]);
  expect(s.queries).toEqual([
    { businessDate: task.businessDate, propertyId: 'p1', assignedTo: 'u1', limit: 100 },
  ]);
});
test('invalid calendar makes no request; empty resolved list has its own state', async () => {
  const s = setup();
  await s.reader.load('2026-02-30', 'p1');
  expect(s.queries).toEqual([]);
  expect(s.reader.state.phase).toBe('validation');
  s.ports.read = async () => ({
    data: [],
    meta: { limit: 100, total: 0, hasMore: false, nextCursor: null },
  });
  await s.reader.load(task.businessDate, 'p1');
  expect(s.reader.state.phase).toBe('empty');
});
test('complete cursor pages preserve unique task IDs; repeated cursor rejects partial data', async () => {
  const s = setup();
  s.ports.read = async (query) => ({
    data: [{ ...task, id: query.cursor ? 't2' : 't1' }],
    meta: {
      limit: 100,
      total: 2,
      hasMore: !query.cursor,
      nextCursor: query.cursor ? null : 'next',
    },
  });
  await s.reader.load(task.businessDate, 'p1');
  expect(s.reader.state.tasks.map((row) => row.id)).toEqual(['t1', 't2']);
  s.ports.read = async () => ({
    data: [task],
    meta: { limit: 100, total: 2, hasMore: true, nextCursor: 'next' },
  });
  await s.reader.load(task.businessDate, 'p1');
  expect(s.reader.state.phase).toBe('error');
  expect(s.reader.state.tasks).toEqual([]);
});
test('wrong assignee or business date rejects the projection rather than exposing another task', async () => {
  for (const value of [
    { ...task, assignedTo: 'other' },
    { ...task, businessDate: '2026-11-02' },
  ]) {
    const s = setup();
    s.ports.read = async () => ({
      data: [value],
      meta: { limit: 100, total: 1, hasMore: false, nextCursor: null },
    });
    await s.reader.load(task.businessDate, 'p1');
    expect(s.reader.state.tasks).toEqual([]);
    expect(s.reader.state.phase).toBe('error');
  }
});
test('principal or scope changed during read cannot publish the old private list', async () => {
  const s = setup();
  s.ports.read = async () => {
    s.actor({ ...actor, propertyScope: ['other'] });
    return { data: [task], meta: { limit: 100, total: 1, hasMore: false, nextCursor: null } };
  };
  await s.reader.load(task.businessDate, 'p1');
  expect(s.reader.state.tasks).toEqual([]);
  expect(s.reader.state.phase).toBe('error');
});
test('session invalidation clears visible tasks and ignores an outstanding late response', async () => {
  const s = setup();
  await s.reader.load(task.businessDate, 'p1');
  let resolve: (value: Awaited<ReturnType<TaskPorts['read']>>) => void = () => {};
  s.ports.read = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = s.reader.load(task.businessDate, 'p1');
  await new Promise((done) => setTimeout(done, 0));
  s.reader.invalidate();
  expect(s.reader.state.tasks).toEqual([]);
  resolve({ data: [task], meta: { limit: 100, total: 1, hasMore: false, nextCursor: null } });
  await pending;
  expect(s.reader.state.tasks).toEqual([]);
});

test('VN default date crosses the UTC boundary without guessing the host timezone', () => {
  expect(todayVN(new Date('2026-10-13T17:01:00Z'))).toBe('2026-10-14');
  expect(todayVN(new Date('2026-10-13T16:59:00Z'))).toBe('2026-10-13');
});
