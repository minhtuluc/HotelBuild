/**
 * Thân trang hạng khoang (HB-310): tem mã hạng, "mặt sau vé" in thông số có nguồn, có ở ga nào, gallery,
 * các hạng khác. Component máy chủ; chỉ gallery chạy ở trình duyệt.
 */
import type { ReactElement } from 'react';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { Breadcrumbs } from '../../../../components/content/breadcrumbs';
import { GalleryGrid, type GalleryItem } from '../../../../components/content/gallery-grid';
import { JsonLd, breadcrumbList } from '../../../../components/content/json-ld';
import { StickyBookingStub } from '../../../../components/content/sticky-booking-stub';
import { landingContent, type CabinClass } from '../../../../content/landing-content';
import { photoAlt, slotById } from '../../../../content/photo-slots';
import { propertyPageByStation, searchCtaHref } from '../../../../content/property-pages';
import {
  roomTypePageKey,
  type RoomTypePageCopy,
  type RoomTypePageKey,
} from '../../../../content/room-type-pages';
import type { Translators } from '../../../../i18n/translate';
import { availablePhotos } from '../../../../lib/photos';
import { absoluteUrl } from '../../../../lib/site';
import { localizePath } from '../../../../i18n/locales';

interface CabinProps {
  readonly pageKey: RoomTypePageKey;
  readonly copy: RoomTypePageCopy;
  readonly cabin: CabinClass;
  readonly text: Translators;
}

function galleryItems(ids: readonly string[], text: Translators): GalleryItem[] {
  const found = availablePhotos(ids);
  return ids.flatMap((id) => {
    const slot = slotById(id);
    const src = found[id];
    return slot === undefined || src === undefined
      ? []
      : [{ id, src, alt: photoAlt(slot, text.locale) }];
  });
}

function SpecSheet({ pageKey, copy, cabin, text }: CabinProps): ReactElement {
  const { t } = text;
  const rows: readonly { readonly label: string; readonly value: string }[] = [
    { label: t('guest.cabin.spec.code'), value: pageKey.code },
    { label: t('guest.cabin.spec.cabin'), value: cabin.cabin },
    { label: t('guest.cabin.spec.capacity'), value: cabin.capacity },
    {
      label: t('guest.cabin.spec.sleeps'),
      value: t('guest.cabin.spec.sleepsValue', { n: pageKey.sleeps }),
    },
    { label: t('guest.cabin.spec.suits'), value: copy.suits },
    { label: t('guest.cabin.spec.price'), value: t('guest.cabin.spec.priceValue') },
    { label: t('guest.cabin.spec.refund'), value: t('guest.cabin.spec.refundValue') },
  ];
  return (
    <section className="ph-spec-sheet" aria-labelledby="cabin-spec" data-testid="cabin-spec">
      <h2 id="cabin-spec">{t('guest.cabin.specTitle')}</h2>
      <dl>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function StationsServed({ pageKey, text }: CabinProps): ReactElement {
  const { t } = text;
  const stations = landingContent(text.locale).stations.filter((station) =>
    pageKey.stationCodes.includes(station.code),
  );
  return (
    <section className="ph-served" aria-labelledby="cabin-stations">
      <h2 id="cabin-stations">{t('guest.cabin.stationsTitle')}</h2>
      <ul>
        {stations.map((station) => {
          const page = propertyPageByStation(station.code);
          return (
            <li key={station.code}>
              <span className="ph-served-code">{station.code}</span>
              {page === undefined ? (
                <span>{station.name}</span>
              ) : (
                <Link href={`/stays/${page.slug}`}>{station.name}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function OtherClasses({ pageKey, text }: CabinProps): ReactElement {
  const { t } = text;
  const others = landingContent(text.locale).cabinClasses.filter(
    (cabin) => cabin.code !== pageKey.code,
  );
  return (
    <section data-reveal className="ph-band ph-band-ticket" aria-labelledby="cabin-others">
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="cabin-others">{t('guest.cabin.otherTitle')}</h2>
        </header>
        <ul className="ph-classes">
          {others.map((cabin) => (
            <li key={cabin.code} className="ph-class">
              <span className="ph-class-media">
                <span className="ph-class-code">{cabin.code}</span>
              </span>
              <span className="ph-class-title">
                <span className="ph-class-name">{cabin.name}</span>
                <span className="ph-class-cabin">{cabin.cabin}</span>
              </span>
              <span className="ph-class-cap">{cabin.capacity}</span>
              <span className="ph-class-detail">{cabin.detail}</span>
              {roomTypePageKey(cabin.code) === undefined ? null : (
                <Link className="ph-class-price" href={`/room-types/${cabin.code}`}>
                  {t('guest.cabin.readMore', { name: cabin.name })}{' '}
                  <span className="ph-arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function CabinSheet(props: CabinProps): ReactElement {
  const { pageKey, copy, cabin, text } = props;
  const { t } = text;
  const ctaHref = searchCtaHref(null);
  const title = t('guest.cabin.title', { name: cabin.name });
  const path = `/room-types/${pageKey.code}`;
  const gallery = galleryItems(pageKey.galleryIds, text);
  return (
    <div className="ph-has-stub">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'HotelRoom',
          name: title,
          description: copy.summary,
          url: absoluteUrl(localizePath(path, text.locale)),
          occupancy: { '@type': 'QuantitativeValue', maxValue: pageKey.sleeps },
        }}
      />
      <JsonLd
        data={breadcrumbList([
          { name: t('guest.content.home'), url: absoluteUrl(localizePath('/', text.locale)) },
          { name: cabin.name, url: absoluteUrl(localizePath(path, text.locale)) },
        ])}
      />
      <div className="ph-page-shell ph-content-shell">
        <header className="ph-content-head ph-cabin-head">
          <div className="ph-content-head-copy">
            <Breadcrumbs
              label={t('guest.content.breadcrumb')}
              items={[
                { label: t('guest.content.home'), href: '/' },
                { label: t('guest.content.classes'), href: '/#hang-phong' },
                { label: cabin.name },
              ]}
            />
            <div className="ph-cabin-title">
              <span className="ph-stamp ph-cabin-stamp" aria-hidden="true">
                <span className="ph-stamp-face">
                  <b>{pageKey.code}</b>
                  <small>{cabin.capacity}</small>
                </span>
              </span>
              <div>
                <h1 className="ph-content-title">{title}</h1>
                <p className="ph-content-kind">{cabin.cabin}</p>
              </div>
            </div>
            <p className="ph-content-lede">{copy.summary}</p>
            <Link href={ctaHref} className="ph-btn ph-btn-accent ph-btn-lg" data-testid="cabin-cta">
              {t('guest.cabin.cta')}
            </Link>
          </div>
          <SpecSheet {...props} />
        </header>
        <div className="ph-content-columns">
          <div className="ph-content-prose">
            {copy.description.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <StationsServed {...props} />
        </div>
        {gallery.length === 0 ? null : (
          <div className="ph-content-gallery">
            <GalleryGrid items={gallery} />
          </div>
        )}
      </div>
      <OtherClasses {...props} />
      <StickyBookingStub title={title} href={ctaHref} cta={t('guest.cabin.cta')} />
    </div>
  );
}
