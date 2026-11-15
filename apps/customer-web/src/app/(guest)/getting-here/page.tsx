/**
 * `/getting-here` — đường đến ba ga (HB-311b, CONT-03). Component máy chủ, không đọc API.
 *
 * Bảng chặng từng ga dùng lại `legs` của trang ga (HB-322) để hai nơi nói cùng một câu. Thời gian là ước
 * lượng; không mã chuyến, không giờ chạy. Thị thực chỉ đặt link tới cổng chính thức (kế hoạch §8.2).
 */
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ChainPageHead, chainMetadata } from '../../../components/content/chain-page';
import { LegsTable } from '../../../components/content/legs-table';
import { RouteMap } from '../../../components/content/route-map';
import { LocaleLink as Link } from '../../../components/locale-link';
import { EVISA_URL, chainPagesCopy } from '../../../content/chain-pages';
import { landingContent } from '../../../content/landing-content';
import { propertyPageByStation, propertyPageCopy } from '../../../content/property-pages';
import { serverTranslators } from '../../../i18n/server';

const PATH = '/getting-here';

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await serverTranslators();
  return chainMetadata(PATH, locale, chainPagesCopy(locale).gettingHere);
}

export default async function GettingHerePage(): Promise<ReactElement> {
  const text = await serverTranslators();
  const { t, locale } = text;
  const copy = chainPagesCopy(locale).gettingHere;
  const stations = landingContent(locale).stations;
  return (
    <div>
      <ChainPageHead
        text={text}
        path={PATH}
        title={t('guest.chain.gettingHere.title')}
        lede={copy.summary}
      >
        <RouteMap
          stations={stations}
          label={t('guest.route.title')}
          hrefFor={(code) => {
            const page = propertyPageByStation(code);
            return page === undefined ? '/#tuyen' : `/stays/${page.slug}`;
          }}
        />
      </ChainPageHead>
      <section
        data-reveal
        className="ph-band ph-band-paper"
        aria-label={t('guest.chain.gettingHere.title')}
      >
        <div className="ph-band-inner ph-chain-stations">
          {stations.map((station) => {
            const page = propertyPageByStation(station.code);
            const stationCopy =
              page === undefined ? undefined : propertyPageCopy(page.slug, locale);
            if (page === undefined || stationCopy === undefined) return null;
            const headingId = `ga-${station.code}`;
            return (
              <section
                key={station.code}
                className="ph-arrival ph-chain-station"
                aria-labelledby={headingId}
                data-testid={`getting-here-${station.code}`}
              >
                <h2 id={headingId}>
                  {t('guest.chain.gettingHere.station', { name: station.name })}
                </h2>
                <LegsTable legs={stationCopy.legs} text={text} />
                <p className="ph-legs-note">{stationCopy.arrivalNote}</p>
                <Link href={`/stays/${page.slug}`} className="ph-chain-more">
                  {t('guest.chain.gettingHere.stationLink', { name: station.name })}{' '}
                  <span className="ph-arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
              </section>
            );
          })}
        </div>
      </section>
      <section data-reveal className="ph-band ph-band-board" aria-labelledby="getting-here-abroad">
        <div className="ph-band-inner">
          <header className="ph-section-head">
            <h2 id="getting-here-abroad">{t('guest.chain.gettingHere.international')}</h2>
          </header>
          <ul className="ph-chain-list">
            {copy.international.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="ph-chain-external">
            <a href={EVISA_URL} rel="noopener noreferrer external" data-testid="evisa-link">
              {t('guest.chain.gettingHere.eVisa')} <span aria-hidden="true">↗</span>
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
