/**
 * Thân trang ăn uống ở ga (HB-318). Component máy chủ, không đọc API.
 *
 * Nhịp dải xen kẽ (UX-07): giấy → bảng ga đen (giờ phục vụ) → giấy (quanh ga, báo trước) → giấy vé (giá đã
 * gồm, CTA). Tên ga lấy từ nội dung trang chủ để mọi trang gọi ga cùng một tên.
 */
import type { ReactElement } from 'react';
import { Breadcrumbs } from '../../../components/content/breadcrumbs';
import { JsonLd, breadcrumbList } from '../../../components/content/json-ld';
import { PriceIncludes } from '../../../components/content/price-includes';
import { LocaleLink as Link } from '../../../components/locale-link';
import { SlotImage } from '../../../components/content/slot-image';
import { DINING_SERVICES, type DiningPageCopy } from '@pinehill/content/dining-page';
import { landingContent } from '@pinehill/content/landing-content';
import { searchCtaHref } from '@pinehill/content/property-pages';
import { localizePath } from '../../../i18n/locales';
import type { Translators } from '../../../i18n/translate';
import { absoluteUrl } from '../../../lib/site';

interface DiningSheetProps {
  readonly text: Translators;
  readonly copy: DiningPageCopy;
  readonly path: string;
}

function ServiceBoard({ text, copy }: DiningSheetProps): ReactElement {
  const { t } = text;
  return (
    <section data-reveal className="ph-band ph-band-board" aria-labelledby="dining-services">
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="dining-services">{t('guest.dining.servicesTitle')}</h2>
        </header>
        <ol className="ph-dining-services" data-testid="dining-services">
          {DINING_SERVICES.map((service) => (
            <li key={service.id} className="ph-dining-service" data-status={service.status}>
              <SlotImage
                id={`an-${service.id}`}
                locale={text.locale}
                sizes="(max-width: 900px) calc(100vw - 32px), 33vw"
                className="ph-dining-photo"
              />
              <p className="ph-dining-hours">
                <span className="ph-sr-only">{t('guest.dining.hours')} </span>
                {service.hours}
              </p>
              <h3>{copy.services[service.id].name}</h3>
              <p>{copy.services[service.id].body}</p>
              <p className="ph-dining-status">{t(`guest.dining.status.${service.status}`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function AroundStations({ text, copy }: DiningSheetProps): ReactElement {
  const { t } = text;
  const stations = landingContent(text.locale).stations;
  return (
    <section data-reveal className="ph-band ph-band-paper" aria-labelledby="dining-nearby">
      <div className="ph-band-inner ph-content-columns">
        <div className="ph-content-prose">
          <h2 id="dining-nearby">{t('guest.dining.nearbyTitle')}</h2>
          <p>{copy.nearbyLede}</p>
          <dl className="ph-dining-nearby">
            {stations.map((station) => (
              <div key={station.code}>
                <dt>{t('guest.station.title', { name: station.name })}</dt>
                {(copy.nearby[station.code] ?? []).map((line) => (
                  <dd key={line}>{line}</dd>
                ))}
              </div>
            ))}
          </dl>
        </div>
        <aside className="ph-arrival" aria-labelledby="dining-notes">
          <h2 id="dining-notes">{t('guest.dining.notesTitle')}</h2>
          <ul>
            {copy.notes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}

export function DiningSheet(props: DiningSheetProps): ReactElement {
  const { text, copy, path } = props;
  const { t } = text;
  const title = t('guest.dining.title');
  const ctaHref = searchCtaHref(null);
  return (
    <div>
      <JsonLd
        data={breadcrumbList([
          { name: t('guest.content.home'), url: absoluteUrl(localizePath('/', text.locale)) },
          { name: title, url: absoluteUrl(localizePath(path, text.locale)) },
        ])}
      />
      <div className="ph-page-shell ph-content-shell">
        <header className="ph-content-head ph-dining-head">
          <div className="ph-content-head-copy">
            <Breadcrumbs
              label={t('guest.content.breadcrumb')}
              items={[{ label: t('guest.content.home'), href: '/' }, { label: title }]}
            />
            <h1 className="ph-content-title">{title}</h1>
            <p className="ph-content-lede">{copy.summary}</p>
            <p className="ph-dining-illustrative">{t('guest.dining.illustrative')}</p>
          </div>
        </header>
      </div>
      <ServiceBoard {...props} />
      <AroundStations {...props} />
      <section
        data-reveal
        className="ph-band ph-band-ticket"
        aria-label={t('guest.includes.title')}
      >
        <div className="ph-band-inner">
          <PriceIncludes text={text} showDorm linkDining={false} />
          <div className="ph-actions ph-content-end">
            <Link
              href={ctaHref}
              className="ph-btn ph-btn-accent ph-btn-lg"
              data-testid="dining-cta"
            >
              {t('guest.station.cta')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
