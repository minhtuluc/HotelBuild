import { Children, isValidElement, type ReactNode } from 'react';
import type { HousekeepingTask } from '@pinehill/contracts';
import { expect, test, vi } from 'vitest';
import { TaskCard, type TaskCardProps } from '../src/housekeeping/task-card';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
}));

function taskWith(businessDate: string): HousekeepingTask {
  return {
    id: '00000000-0000-4000-8000-000000000301',
    roomId: '00000000-0000-4000-8000-000000000401',
    roomCode: '101',
    businessDate,
    status: 'PENDING',
    assignedTo: '00000000-0000-4000-8000-000000000101',
    note: null,
    completedAt: null,
    version: 1,
  };
}

interface CardNodeProps {
  children?: ReactNode;
  accessibilityLabel?: string;
}
/** Mọi chuỗi thẻ thật sự dựng ra, gồm cả nhãn trợ năng — không chỉ text trong JSX. */
function rendered(node: ReactNode, out: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (!isValidElement<CardNodeProps>(node)) return out;
  if (node.props.accessibilityLabel) out.push(node.props.accessibilityLabel);
  for (const child of Children.toArray(node.props.children)) rendered(child, out);
  return out;
}

function cardOf(businessDate: string): string[] {
  const props: TaskCardProps = {
    task: taskWith(businessDate),
    disabled: false,
    onRequest: async () => {},
  };
  return rendered(TaskCard(props));
}

test.each([
  ['2026-11-01', '01/11/2026'],
  ['2026-03-05', '05/03/2026'],
])('thẻ nhiệm vụ %s hiện ngày lịch dd/MM/yyyy %s, không lộ chuỗi ISO', (businessDate, shown) => {
  const lines = cardOf(businessDate);
  expect(lines).toContain(shown);
  expect(lines.join('\n')).not.toContain(businessDate);
});

test('mốc thời gian đầy đủ không bị hiển thị như ngày lịch', () => {
  expect(() => cardOf('2026-11-01T00:00:00Z')).toThrow(RangeError);
});
