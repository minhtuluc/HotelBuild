/**
 * API giả F8 — CRM quản trị (HB-167): danh sách hồ sơ khách, hạng & điểm, ẩn danh hoá, danh sách đen.
 * Dựng đúng hợp đồng HB-160 phần CRM (`GET/POST /guests`, `/loyalty`, `/anonymize`, `/blacklist`).
 */
import type { Page, Route } from '@playwright/test';

export const GUEST_AN = {
  id: 'g1',
  fullName: 'Nguyễn Văn An',
  phone: '+84912000001',
  email: 'an@example.com',
  loyaltyTier: 'GOLD' as const,
  loyaltyPoints: 1200,
  totalStays: 7,
  blacklisted: false,
  consentMarketing: true,
  createdAt: '2026-09-19T03:14:02Z',
};

export const GUEST_BINH = {
  id: 'g2',
  fullName: 'Trần Thị Bình',
  phone: '+84912000002',
  email: null,
  loyaltyTier: 'GUEST' as const,
  loyaltyPoints: 0,
  totalStays: 1,
  blacklisted: true,
  consentMarketing: false,
  createdAt: '2026-08-01T02:00:00Z',
};

/** Hồ sơ sau ẩn danh hoá: PII đã thay/che, vẫn giữ id để đối soát (BR-CRM-05). */
export const GUEST_ANONYMIZED = {
  ...GUEST_AN,
  fullName: 'Khách đã ẩn danh',
  phone: '+8491****01',
  email: null,
  consentMarketing: false,
};

export const LOYALTY_AN = {
  guestId: 'g1',
  loyaltyTier: 'GOLD' as const,
  loyaltyPoints: 1200,
  staysLast12Months: 3,
  totalStays: 7,
  updatedAt: '2026-10-02T00:00:00Z',
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

export interface CrmApiOptions {
  readStatus?: number;
  readErrorBody?: string;
}

export interface CrmApiSpy {
  anonymizeBodies: () => string[];
  blacklistBodies: () => string[];
  releaseUrls: () => string[];
  urls: () => string[];
}

/** Cài API giả CRM; trả spy để khẳng định thân lệnh ẩn danh/blacklist và tham số tra cứu. */
export function installCrmApi(page: Page, options: CrmApiOptions = {}): CrmApiSpy {
  const anonymizeBodies: string[] = [];
  const blacklistBodies: string[] = [];
  const releaseUrls: string[] = [];
  const urls: string[] = [];
  const readStatus = options.readStatus ?? 200;

  void page.route('**/api/session/sys/guests**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    urls.push(request.url());
    if (readStatus !== 200 && request.method() === 'GET' && !url.pathname.endsWith('/loyalty')) {
      return json(route, readStatus, options.readErrorBody ?? '{}');
    }
    if (url.pathname.endsWith('/loyalty')) return json(route, 200, JSON.stringify(LOYALTY_AN));
    if (url.pathname.endsWith('/anonymize')) {
      anonymizeBodies.push(request.postData() ?? '');
      return json(route, 200, JSON.stringify(GUEST_ANONYMIZED));
    }
    if (url.pathname.endsWith('/blacklist')) {
      if (request.method() === 'DELETE') {
        releaseUrls.push(request.url());
        return json(route, 204, '');
      }
      blacklistBodies.push(request.postData() ?? '');
      return json(route, 200, JSON.stringify({ ...GUEST_AN, blacklisted: true }));
    }
    if (readStatus !== 200) return json(route, readStatus, options.readErrorBody ?? '{}');
    return json(route, 200, listBody([GUEST_AN, GUEST_BINH]));
  });

  return {
    anonymizeBodies: () => anonymizeBodies,
    blacklistBodies: () => blacklistBodies,
    releaseUrls: () => releaseUrls,
    urls: () => urls,
  };
}
