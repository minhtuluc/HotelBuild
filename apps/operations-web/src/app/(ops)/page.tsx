import type { ReactElement } from 'react';
import { webEnv } from '../../config';
import { t } from '../../lib/i18n';
import { ApiProbe } from './api-probe';
import { STATE_SLUGS } from './states/fixtures';

/** Trang chủ là tuyến động vì đọc cấu hình API ở thời điểm gọi (kiến trúc §7.5). */
export const dynamic = 'force-dynamic';

export default function OperationsHomePage(): ReactElement {
  return (
    <section style={{ padding: 'var(--space-s6, 24px)' }}>
      <h1>t('ops.home.title')</h1>
      <p>t('ops.home.intro')</p>
      <section style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}>
        <h2 style={{ fontSize: 'var(--text-h2, 18px)', margin: 0 }}>{t('api.probe.title')}</h2>
        <ApiProbe baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
      </section>
      <h2>t('ops.home.screens')</h2>
      <ul>
        <li>
          <a href="/properties">{t('ops.nav.properties')}</a>
        </li>
        <li>
          <a href="/room-types">{t('ops.nav.roomTypes')}</a>
        </li>
        <li>
          <a href="/rooms">{t('ops.nav.rooms')}</a>
          <a href="/inventory-grid">{t('ops.nav.grid')}</a>
        </li>
        <li>
          <a href="/rate-calendar">{t('ops.nav.rateCalendar')}</a>
          <a href="/audit-logs">{t('ops.nav.auditLogs')}</a>
        </li>
      </ul>
      <h2>t('ops.home.states')</h2>
      <ul>
        {STATE_SLUGS.map((slug) => (
          <li key={slug}>
            <a href={`/states?state=${slug}`}>
              {t('ops.home.openState')} · {slug}
            </a>
          </li>
        ))}
      </ul>
      <p>
        <a href="/access-denied">{t('access.denied.title')}</a>
      </p>
      <p>t('ops.demo.only')</p>
    </section>
  );
}
