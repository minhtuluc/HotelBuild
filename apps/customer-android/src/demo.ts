/**
 * Câu chữ và fixture minh hoạ cho khung F0 của Customer Android.
 * Không chứa luật nghiệp vụ; mọi giá trị hiển thị thật sẽ đến từ API (ADR-018).
 */
import { makeTranslate, stateMessages, type ScreenState } from '@pinehill/ui-native';

export const catalog = {
  ...stateMessages,
  'demo.title': 'Pine Hill — Customer Android (F0)',
  'demo.openState': 'Xem trạng thái',
  'demo.checkApi': 'Kiểm tra kết nối API',
  'demo.sampleContent': 'Nội dung mẫu — thay bằng màn hình nghiệp vụ ở F1–F5.',
} as const;

export const t = makeTranslate(catalog);

export const stateSlugs = [
  'ready',
  'loading',
  'refreshing',
  'empty',
  'validation-error',
  'forbidden',
  'conflict',
  'expired',
  'unknown-outcome',
  'success',
] as const;

export type StateSlug = (typeof stateSlugs)[number];

const updatedAt = '2026-11-12T07:00:00.000Z';
const expiresAt = '2026-11-12T07:15:00.000Z';

export function fixtureFor(slug: StateSlug): ScreenState {
  switch (slug) {
    case 'ready':
      return { kind: 'ready' };
    case 'loading':
      return { kind: 'loading' };
    case 'refreshing':
      return { kind: 'refreshing', updatedAt, stale: false };
    case 'empty':
      return { kind: 'empty', reason: 'soldOut', canCreate: false };
    case 'validation-error':
      return { kind: 'validationError', details: [{ field: 'adults', issue: 'OUT_OF_RANGE' }] };
    case 'forbidden':
      return { kind: 'forbidden' };
    case 'conflict':
      return {
        kind: 'conflict',
        currentVersion: '8',
        attemptedVersion: '7',
        onReload: () => undefined,
      };
    case 'expired':
      return { kind: 'expired', expiresAt, onReload: () => undefined };
    case 'unknown-outcome':
      return { kind: 'unknownOutcome', referenceId: 'trace-f0-demo', onLookup: () => undefined };
    default:
      return { kind: 'success' };
  }
}
