import type { ReactElement } from 'react';
import { webEnv } from '../../config';
import { t } from '../../lib/i18n';
import { ApiProbe } from './api-probe';
import { STATE_SLUGS } from './states/fixtures';

/** Trang chủ là tuyến động vì đọc cấu hình API ở thời điểm gọi (kiến trúc §7.5). */
export const dynamic = 'force-dynamic';

export default function GuestHomePage(): ReactElement {
  return (
    <section style={{ padding: 'var(--space-s6, 24px)' }}>
      <h1>t('guest.home.title')</h1>
      <p>t('guest.home.intro')</p>
      <section style={{ display: 'grid', gap: 'var(--space-s2, 8px)' }}>
        <h2 style={{ fontSize: 'var(--text-h2, 18px)', margin: 0 }}>{t('api.probe.title')}</h2>
        <ApiProbe baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
      </section>
      <h2>t('guest.home.states')</h2>
      <ul>
        {STATE_SLUGS.map((slug) => (
          <li key={slug}>
            <a href={`/states?state=${slug}`}>
              {t('guest.home.openState')} · {slug}
            </a>
          </li>
        ))}
      </ul>
      <p>
        <a href="/access-denied">{t('access.denied.title')}</a>
      </p>
      <p>t('guest.demo.only')</p>
    </section>
  );
}
