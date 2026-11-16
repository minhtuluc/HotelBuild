import type { ReactElement } from 'react';
import { LocaleLink as Link } from './locale-link';
import { PineHillBrand } from '@pinehill/ui-web';
import { serverTranslators } from '../i18n/server';
import { LanguageSelect } from './language-select';
import { VnClock } from './vn-clock';
import { HeaderAccount } from './header-account';
import { ExploreMenu, type ExploreGroup } from './explore-menu';
import { landingContent } from '../content/landing-content';
import { propertyPageByStation } from '../content/property-pages';
import type { Translators } from '../i18n/translate';

const NAV_ITEMS = [
  { href: '/#search-block', key: 'guest.nav.search' },
  { href: '/bookings', key: 'guest.nav.bookings' },
] as const;

/** Chân trang giữ đủ link tài khoản; header thay hai link này bằng trạng thái đăng nhập (TD-42). */
const ACCOUNT_ITEMS = [
  { href: '/profile', key: 'guest.nav.profile' },
  { href: '/account/login', key: 'guest.nav.account' },
] as const;

/** Trang nội dung toàn chuỗi (HB-318, HB-311b): trong menu Khám phá và chân trang. */
const CHAIN_ITEMS = [
  { href: '/#hang-phong', key: 'guest.nav.classes' },
  { href: '/getting-here', key: 'guest.nav.gettingHere' },
  { href: '/experiences', key: 'guest.nav.experiences' },
  { href: '/dining', key: 'guest.nav.dining' },
  { href: '/offers', key: 'guest.nav.offers' },
  { href: '/gallery', key: 'guest.nav.gallery' },
] as const;

const FOOTER_ITEMS = [
  ...NAV_ITEMS,
  ...ACCOUNT_ITEMS,
  ...CHAIN_ITEMS.filter((item) => !item.href.startsWith('/#')),
] as const;

/** Nhóm link của menu Khám phá: ba ga (tên theo nội dung trang chủ) và các trang toàn chuỗi. */
function exploreGroups({ t, locale }: Translators): readonly ExploreGroup[] {
  const stations = landingContent(locale).stations.flatMap((station) => {
    const page = propertyPageByStation(station.code);
    return page === undefined
      ? []
      : [{ href: `/stays/${page.slug}`, label: t('guest.station.title', { name: station.name }) }];
  });
  return [
    { title: t('guest.nav.stationsGroup'), links: stations },
    {
      title: t('guest.nav.pagesGroup'),
      links: CHAIN_ITEMS.map((item) => ({ href: item.href, label: t(item.key) })),
    },
  ];
}

/** Dải bảng ga trên cùng: tên tuyến, điều hướng, chọn ngôn ngữ, giờ VN. */
export async function GuestHeader(): Promise<ReactElement> {
  const text = await serverTranslators();
  const { t } = text;
  return (
    <header className="ph-header">
      <div className="ph-header-inner">
        <Link href="/" className="ph-brand-link" aria-label={t('guest.nav.brandAria')}>
          <PineHillBrand tone="dark" />
        </Link>
        <nav aria-label={t('guest.nav.primary')} className="ph-nav">
          <ExploreMenu
            label={t('guest.nav.explore')}
            title={t('guest.nav.exploreTitle')}
            closeLabel={t('guest.nav.close')}
            groups={exploreGroups(text)}
          />
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="ph-nav-link">
              {t(item.key)}
            </Link>
          ))}
          <HeaderAccount />
        </nav>
        <div className="ph-header-tools">
          <LanguageSelect />
          <VnClock label={t('guest.home.clock')} />
        </div>
      </div>
    </header>
  );
}

export async function GuestFooter(): Promise<ReactElement> {
  const { t } = await serverTranslators();
  return (
    <footer className="ph-footer">
      <div className="ph-footer-inner">
        <div className="ph-footer-top">
          <Link href="/" className="ph-brand-link" aria-label={t('guest.nav.brandAria')}>
            <PineHillBrand tone="dark" compact subtitle={t('guest.brand.subtitle')} />
          </Link>
          <nav aria-label={t('guest.nav.footer')} className="ph-footer-nav">
            {FOOTER_ITEMS.map((item) => (
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
