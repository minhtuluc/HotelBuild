import type { ReactElement } from 'react';
import Link from 'next/link';
import { webEnv } from '../../config';
import { t, type OperationsMessageKey } from '../../lib/i18n';
import {
  OPS_HEADER_STYLE,
  OPS_INTRO_STYLE,
  OPS_PAGE_STYLE,
  OPS_TITLE_STYLE,
} from '../../components/editorial-styles';
import { ApiProbe } from './api-probe';

/** Trang chủ là tuyến động vì đọc cấu hình API ở thời điểm gọi (kiến trúc §7.5). */
export const dynamic = 'force-dynamic';

interface ShiftTask {
  readonly href: string;
  readonly labelKey: OperationsMessageKey;
  readonly descKey: OperationsMessageKey;
}

/** Việc lặp lại nhiều nhất trong một ca quầy; phần còn lại nằm ở thanh bên, không lặp lại ở đây. */
const SHIFT_TASKS: readonly ShiftTask[] = [
  { href: '/front-desk', labelKey: 'ops.nav.frontDesk', descKey: 'ops.home.task.frontDesk' },
  { href: '/day-board', labelKey: 'ops.nav.dayBoard', descKey: 'ops.home.task.dayBoard' },
  { href: '/inventory-grid', labelKey: 'ops.nav.grid', descKey: 'ops.home.task.grid' },
  { href: '/bookings', labelKey: 'ops.nav.bookings', descKey: 'ops.home.task.bookings' },
  {
    href: '/overbooking/cases',
    labelKey: 'ops.nav.overbooking',
    descKey: 'ops.home.task.overbooking',
  },
] as const;

export default function OperationsHomePage(): ReactElement {
  return (
    <section style={{ ...OPS_PAGE_STYLE, maxWidth: 960 }}>
      <header style={OPS_HEADER_STYLE}>
        <h1 style={OPS_TITLE_STYLE}>{t('ops.home.title')}</h1>
        <p style={OPS_INTRO_STYLE}>{t('ops.home.intro')}</p>
      </header>

      <nav aria-label={t('ops.home.screens')}>
        <ul className="ph-list-lines">
          {SHIFT_TASKS.map((task) => (
            <li key={task.href} style={{ padding: 0 }}>
              <Link href={task.href} className="ph-task-link">
                <strong>{t(task.labelKey)}</strong>
                <span>{t(task.descKey)}</span>
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section
        aria-label={t('ops.home.status')}
        style={{ fontSize: 14, color: 'var(--color-textMuted)' }}
      >
        <ApiProbe baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
      </section>
    </section>
  );
}
