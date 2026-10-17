/**
 * API giả F8 — thông báo (HB-169): hàng đợi thông báo + gửi lại (BR-SYS-06).
 * Fixture dựng đủ ba tình huống của nút gửi lại: được phép, chưa đủ 5 phút, đã đủ 3 lần.
 */
import type { Page, Route } from '@playwright/test';

const OLD = '2026-09-19T03:14:02Z';

export const NOTI_OK = {
  id: 'n1',
  bookingId: 'b1',
  channel: 'EMAIL' as const,
  template: 'BOOKING_CONFIRMED',
  status: 'SENT' as const,
  recipientMasked: 'an***@example.com',
  retryCount: 0,
  errorMessage: null,
  sentAt: OLD,
  createdAt: OLD,
};

/** Lần thử gần nhất mới đây (1 phút trước) → chưa đủ 5 phút nên không gửi lại được. */
export const NOTI_TOO_SOON = {
  id: 'n2',
  bookingId: 'b2',
  channel: 'SMS' as const,
  template: 'CHECKIN_REMINDER',
  status: 'SENT' as const,
  recipientMasked: '+8491****02',
  retryCount: 1,
  errorMessage: null,
  sentAt: new Date(Date.now() - 60_000).toISOString(),
  createdAt: OLD,
};

export const NOTI_MAX_RETRIES = {
  id: 'n3',
  bookingId: null,
  channel: 'ZALO_OA' as const,
  template: 'PAYMENT_RECEIPT',
  status: 'FAILED' as const,
  recipientMasked: '+8491****03',
  retryCount: 3,
  errorMessage: 'Nhà cung cấp Zalo trả 500',
  sentAt: OLD,
  createdAt: OLD,
};

function json(route: Route, status: number, body: string): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body });
}

function listBody(rows: readonly unknown[]): string {
  return JSON.stringify({
    data: rows,
    meta: { limit: 20, nextCursor: null, hasMore: false, total: rows.length },
  });
}

export interface NotiApiOptions {
  readStatus?: number;
  readErrorBody?: string;
}

export interface NotiApiSpy {
  resendBodies: () => string[];
  urls: () => string[];
}

/** Cài API giả thông báo; trả spy để khẳng định thân lệnh gửi lại và bộ lọc tra cứu. */
export function installNotiApi(page: Page, options: NotiApiOptions = {}): NotiApiSpy {
  const resendBodies: string[] = [];
  const urls: string[] = [];
  const readStatus = options.readStatus ?? 200;

  void page.route('**/api/session/sys/notifications**', async (route) => {
    const request = route.request();
    urls.push(request.url());
    if (readStatus !== 200) return json(route, readStatus, options.readErrorBody ?? '{}');
    if (request.method() === 'POST') {
      resendBodies.push(request.postData() ?? '');
      return json(route, 200, JSON.stringify({ ...NOTI_OK, retryCount: 1 }));
    }
    return json(route, 200, listBody([NOTI_OK, NOTI_TOO_SOON, NOTI_MAX_RETRIES]));
  });

  return { resendBodies: () => resendBodies, urls: () => urls };
}
