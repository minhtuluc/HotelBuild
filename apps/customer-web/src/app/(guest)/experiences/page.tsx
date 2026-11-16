/**
 * `/experiences` — việc đáng làm quanh ga (HB-311b, CONT-05). Component máy chủ, không đọc API.
 *
 * Ba hoạt động mỗi ga, gắn "Quanh năm" hoặc tháng đẹp nhất. Không lịch sự kiện có ngày cụ thể, không tour,
 * không giá (kế hoạch §8.2). Nhịp dải xen kẽ giấy / bảng ga đen (UX-07).
 */
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ChainPageHead, chainMetadata } from '../../../components/content/chain-page';
import { LocaleLink as Link } from '../../../components/locale-link';
import { EXPERIENCES, chainPagesCopy } from '../../../content/chain-pages';
import { landingContent } from '../../../content/landing-content';
import { propertyPageByStation, searchCtaHref } from '../../../content/property-pages';
import { monthRange } from '../../../i18n/format';
import { serverTranslators } from '../../../i18n/server';

const PATH = '/experiences';

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await serverTranslators();
  return chainMetadata(PATH, locale, chainPagesCopy(locale).experiences);
}

export default async function ExperiencesPage(): Promise<ReactElement> {
  const text = await serverTranslators();
  const { t, locale } = text;
  const copy = chainPagesCopy(locale).experiences;
  const stations = landingContent(locale).stations;
  return (
    <div>
      <ChainPageHead
        text={text}
        path={PATH}
        title={t('guest.chain.experiences.title')}
        lede={copy.summary}
      />
      {stations.map((station, index) => {
        const page = propertyPageByStation(station.code);
        const items = EXPERIENCES.filter((item) => item.stationCode === station.code);
        const headingId = `trai-nghiem-${station.code}`;
        return (
          <section
            key={station.code}
            data-reveal
            className={`ph-band ${index % 2 === 0 ? 'ph-band-paper' : 'ph-band-board'}`}
            aria-labelledby={headingId}
            data-testid={`experiences-${station.code}`}
          >
            <div className="ph-band-inner">
              <header className="ph-section-head">
                <h2 id={headingId}>{t('guest.station.title', { name: station.name })}</h2>
              </header>
              <ol className="ph-experiences">
                {items.map((item) => (
                  <li key={item.id} className="ph-experience">
                    <p className="ph-experience-when">
                      {item.months === null
                        ? t('guest.chain.experiences.yearRound')
                        : monthRange(item.months, locale)}
                    </p>
                    <h3>{copy.items[item.id]?.name}</h3>
                    <p>{copy.items[item.id]?.body}</p>
                  </li>
                ))}
              </ol>
              {page === undefined ? null : (
                <div className="ph-actions ph-chain-actions">
                  <Link href={searchCtaHref(page.slug)} className="ph-btn ph-btn-accent">
                    {t('guest.chain.experiences.searchCta', { name: station.name })}
                  </Link>
                  <Link href={`/stays/${page.slug}`} className="ph-chain-more">
                    {t('guest.station.readMore', { name: station.name })}{' '}
                    <span className="ph-arrow" aria-hidden="true">
                      →
                    </span>
                  </Link>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
