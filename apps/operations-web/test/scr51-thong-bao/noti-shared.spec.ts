/** HB-169: phần thuần SCR-51 — quy tắc gửi lại (BR-SYS-06), lý do bắt buộc, nhãn trạng thái/kênh. */
import { describe, expect, it } from 'vitest';
import type { NotificationSummary } from '@pinehill/contracts';
import {
  CHANNEL_LABEL_KEY,
  RESEND_MIN_GAP_MS,
  STATUS_LABEL_KEY,
  notiParams,
  resendIssues,
  resendRequest,
  resendState,
} from '../../src/app/(ops)/noti/noti-shared';

const NOW = Date.parse('2026-10-06T12:00:00Z');

function notice(overrides: Partial<NotificationSummary>): NotificationSummary {
  return {
    id: 'n1',
    bookingId: 'b1',
    channel: 'EMAIL',
    template: 'BOOKING_CONFIRMED',
    status: 'SENT',
    recipientMasked: 'an***@example.com',
    retryCount: 0,
    errorMessage: null,
    sentAt: '2026-09-19T03:14:02Z',
    createdAt: '2026-09-19T03:14:02Z',
    ...overrides,
  };
}

describe('resendState (AC1, BR-SYS-06)', () => {
  it('cho gửi lại khi lần thử gần nhất đã quá 5 phút và chưa đủ 3 lần', () => {
    expect(resendState(notice({}), NOW)).toEqual({ allowed: true, reason: null });
  });

  it('chặn khi đã đủ 3 lần gửi lại', () => {
    expect(resendState(notice({ retryCount: 3, status: 'FAILED' }), NOW)).toEqual({
      allowed: false,
      reason: 'MAX_RETRIES',
    });
  });

  it('chặn khi chưa đủ 5 phút kể từ lần thử trước', () => {
    const recent = new Date(NOW - RESEND_MIN_GAP_MS + 1_000).toISOString();
    expect(resendState(notice({ sentAt: recent }), NOW)).toEqual({
      allowed: false,
      reason: 'TOO_SOON',
    });
    const justEnough = new Date(NOW - RESEND_MIN_GAP_MS).toISOString();
    expect(resendState(notice({ sentAt: justEnough }), NOW)).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it('chưa gửi lần nào thì lấy mốc tạo bản ghi', () => {
    const recent = new Date(NOW - 1_000).toISOString();
    expect(resendState(notice({ sentAt: null, createdAt: recent }), NOW)).toEqual({
      allowed: false,
      reason: 'TOO_SOON',
    });
    expect(resendState(notice({ sentAt: null }), NOW)).toEqual({ allowed: true, reason: null });
  });
});

describe('resendIssues / resendRequest (AC1)', () => {
  it('lý do bắt buộc và được cắt khoảng trắng khi gửi', () => {
    expect(resendIssues('   ')).toEqual([{ field: 'reason', issue: 'REQUIRED' }]);
    expect(resendIssues('Khách chưa nhận mail')).toEqual([]);
    expect(resendRequest('  Khách chưa nhận mail  ')).toEqual({ reason: 'Khách chưa nhận mail' });
  });
});

describe('notiParams + nhãn (AC1)', () => {
  it('chỉ gửi bộ lọc đã chọn', () => {
    expect(notiParams({ status: '', channel: '', template: '  ' })).toEqual({});
    expect(notiParams({ status: 'FAILED', channel: 'SMS', template: ' PAYMENT_RECEIPT ' })).toEqual(
      { status: 'FAILED', channel: 'SMS', template: 'PAYMENT_RECEIPT' },
    );
  });

  it('đủ nhãn cho ba trạng thái và bốn kênh', () => {
    expect(Object.keys(STATUS_LABEL_KEY).sort()).toEqual(['FAILED', 'PENDING', 'SENT']);
    expect(Object.keys(CHANNEL_LABEL_KEY).sort()).toEqual(['EMAIL', 'PUSH', 'SMS', 'ZALO_OA']);
  });
});
