'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { authText as text } from './messages';

type NavTextKey = Parameters<typeof text>[0];

export interface NavGroupItem {
  readonly href: string;
  readonly labelKey: NavTextKey;
}

export interface NavGroup {
  readonly titleKey: NavTextKey;
  readonly items: readonly NavGroupItem[];
}

export const OPS_NAV_GROUPS: readonly NavGroup[] = [
  {
    titleKey: 'navGroupFrontDesk',
    items: [
      { href: '/', labelKey: 'navHome' },
      { href: '/front-desk', labelKey: 'navFrontDesk' },
      { href: '/day-board', labelKey: 'navDayBoard' },
      { href: '/inventory-grid', labelKey: 'navGrid' },
      { href: '/rooms', labelKey: 'navRooms' },
      { href: '/room-blocks', labelKey: 'navRoomBlocks' },
      { href: '/overbooking/cases', labelKey: 'navOverbooking' },
      { href: '/overbooking/policy-exceptions', labelKey: 'navPolicyExceptions' },
    ],
  },
  {
    titleKey: 'navGroupRatesOta',
    items: [
      { href: '/rate-calendar', labelKey: 'navRateCalendar' },
      { href: '/rate-plans', labelKey: 'navRatePlans' },
      { href: '/seasons', labelKey: 'navSeasons' },
      { href: '/promotions', labelKey: 'navPromotions' },
      { href: '/channels', labelKey: 'navChannels' },
      { href: '/channels/configuration', labelKey: 'navChannelConfiguration' },
      { href: '/channels/sync', labelKey: 'navChannelSync' },
      { href: '/channels/ota-bookings', labelKey: 'navOtaBookings' },
      { href: '/channel-allotments', labelKey: 'navAllotments' },
      { href: '/multi-channel-quote', labelKey: 'navMultiChannelQuote' },
    ],
  },
  {
    titleKey: 'navGroupBookingsFinance',
    items: [
      { href: '/bookings', labelKey: 'navBookings' },
      { href: '/bookings/new', labelKey: 'navNewBooking' },
      { href: '/reconciliation', labelKey: 'navReconciliation' },
      { href: '/crm/guests', labelKey: 'navCrmGuests' },
      { href: '/crm/loyalty', labelKey: 'navCrmLoyalty' },
      { href: '/noti/notifications', labelKey: 'navNotifications' },
    ],
  },
  {
    titleKey: 'navGroupReportsSystem',
    items: [
      { href: '/properties', labelKey: 'navProperties' },
      { href: '/room-types', labelKey: 'navRoomTypes' },
      { href: '/reports/occupancy', labelKey: 'navReportsOccupancy' },
      { href: '/reports/revenue-by-channel', labelKey: 'navReportsRevenue' },
      { href: '/reports/cancellations', labelKey: 'navReportsCancellations' },
      { href: '/reports/overbooking', labelKey: 'navReportsOverbooking' },
      { href: '/admin/users', labelKey: 'navUsers' },
      { href: '/audit-logs', labelKey: 'navAuditLogs' },
      { href: '/system-settings', labelKey: 'navSettings' },
    ],
  },
] as const;

function matches(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Mục đang mở: khớp đúng đường dẫn, hoặc là tiền tố của phân hệ con (trừ trang chủ). Khi nhiều mục cùng khớp
 * (`/bookings` và `/bookings/new`) chỉ mục dài nhất được đánh dấu, để `aria-current` không trỏ hai nơi.
 */
export function currentNavHref(pathname: string): string | null {
  let best: string | null = null;
  for (const group of OPS_NAV_GROUPS)
    for (const { href } of group.items)
      if (matches(pathname, href) && (best === null || href.length > best.length)) best = href;
  return best;
}

export function OpsModuleNav({ onNavigate }: { onNavigate: () => void }): ReactElement {
  const current = currentNavHref(usePathname() ?? '/');
  return (
    <nav
      id="ops-module-nav"
      data-testid="ops-module-nav"
      aria-label={text('navLabel')}
      className="ph-ops-nav"
    >
      {OPS_NAV_GROUPS.map((group) => (
        <div key={group.titleKey} className="ph-ops-nav-group">
          <p className="ph-ops-nav-title">{text(group.titleKey)}</p>
          <ul>
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className="ph-ops-nav-link"
                  aria-current={item.href === current ? 'page' : undefined}
                >
                  {text(item.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
