/**
 * Phần hiển thị dùng chung cho SCR-80/81/82 (HB-113/114): thông báo trạng thái tải của một booking.
 *
 * Giữ đúng hợp đồng §8.1: `failed` nêu mã lỗi, offline nêu mốc đã tải ("có thể đã cũ") và nói rõ khi
 * booking đang mở chưa từng được tải về máy. Mọi câu chữ nằm trong `src/strings.ts`.
 */
import type { ReactElement } from 'react';
import { Text } from 'react-native';
import { color, formatDateTimeVn } from '@pinehill/ui-native';
import { t } from './strings';
import type { OrderDetailOutcome } from './orders';

interface Notice {
  readonly testId: string;
  readonly text: string;
  readonly tone: 'warning' | 'danger';
}

export function noticesOf(outcome: OrderDetailOutcome | null): readonly Notice[] {
  if (outcome === null) return [];
  if (outcome.kind === 'failed')
    return [
      {
        testId: 'order-failed',
        text: t('orders.failed', { code: outcome.code ?? 'UNKNOWN' }),
        tone: 'danger',
      },
    ];
  if (outcome.kind === 'notFound')
    return [{ testId: 'order-not-found', text: t('orders.detail.notFound'), tone: 'danger' }];
  if (outcome.kind !== 'offline') return [];
  const time =
    outcome.cachedAt === null ? t('orders.stale.unknown') : formatDateTimeVn(outcome.cachedAt);
  const stale: Notice = {
    testId: 'order-stale',
    text: t('orders.stale', { time }),
    tone: 'warning',
  };
  if (outcome.booking !== null) return [stale];
  return [
    stale,
    { testId: 'order-not-cached', text: t('orders.detail.notCached'), tone: 'danger' },
  ];
}

export function OrderNotices({ outcome }: { outcome: OrderDetailOutcome | null }): ReactElement {
  return (
    <>
      {noticesOf(outcome).map((notice) => (
        <Text
          key={notice.testId}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          data-testid={notice.testId}
          style={{ color: notice.tone === 'warning' ? color.warning : color.danger }}
        >
          {notice.text}
        </Text>
      ))}
    </>
  );
}
