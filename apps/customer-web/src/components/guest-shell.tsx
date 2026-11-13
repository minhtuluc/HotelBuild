import type { ReactElement } from 'react';
import Link from 'next/link';
import { PineHillBrand } from '@pinehill/ui-web';
import { t } from '../lib/i18n';
import { VnClock } from './vn-clock';

const NAV_ITEMS = [
  { href: '/#search-block', key: 'guest.nav.search' },
  { href: '/bookings', key: 'guest.nav.bookings' },
  { href: '/profile', key: 'guest.nav.profile' },
  { href: '/account/login', key: 'guest.nav.account' },
] as const;

/** Dải bảng ga trên cùng: tên tuyến, điều hướng, giờ VN. */
export function GuestHeader(): ReactElement {
  return (
    <header className="ph-header">
      <div className="ph-header-inner">
        <Link href="/" className="ph-brand-link" aria-label={t('guest.nav.brandAria')}>
          <PineHillBrand tone="dark" />
        </Link>
        <nav aria-label={t('guest.nav.primary')} className="ph-nav">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="ph-nav-link">
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <VnClock label={t('guest.home.clock')} />
      </div>
    </header>
  );
}

export function GuestFooter(): ReactElement {
  return (
    <footer className="ph-footer">
      <div className="ph-footer-inner">
        <div className="ph-footer-top">
          <Link href="/" className="ph-brand-link" aria-label={t('guest.nav.brandAria')}>
            <PineHillBrand tone="dark" compact subtitle={t('guest.brand.subtitle')} />
          </Link>
          <nav aria-label={t('guest.nav.footer')} className="ph-footer-nav">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="ph-footer-link">
                {t(item.key)}
              </Link>
            ))}
          </nav>
        </div>
        <div className="ph-footer-bottom">
          <p>{t('guest.footer.note')}</p>
          <p>{t('guest.footer.time')}</p>
        </div>
      </div>
    </footer>
  );
}
