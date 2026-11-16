/**
 * Thân trang hạng khoang (HB-310): tem mã hạng, "mặt sau vé" in thông số có nguồn, có ở ga nào, gallery,
 * các hạng khác. Component máy chủ; chỉ gallery chạy ở trình duyệt.
 */
import type { ReactElement } from 'react';
import { LocaleLink as Link } from '../../../../components/locale-link';
import { PriceIncludes } from '../../../../components/content/price-includes';
import { Breadcrumbs } from '../../../../components/content/breadcrumbs';
import { GalleryGrid, type GalleryItem } from '../../../../components/content/gallery-grid';
import { JsonLd, breadcrumbList } from '../../../../components/content/json-ld';
import { StickyBookingStub } from '../../../../components/content/sticky-booking-stub';
import { JourneyCta } from '../../../../components/content/journey-cta';
import { ClassCompare } from '../../../../components/content/class-compare';
import { landingContent, type CabinClass } from '../../../../content/landing-content';
import { photoAlt, slotById } from '../../../../content/photo-slots';
import { propertyPageByStation, searchCtaHref } from '../../../../content/property-pages';
import { type RoomTypePageCopy, type RoomTypePageKey } from '../../../../content/room-type-pages';
import type { Translators } from '../../../../i18n/translate';
import { availablePhotos, photoSrcSet } from '../../../../lib/photos';
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
      : [{ id, src, srcSet: photoSrcSet(src), alt: photoAlt(slot, text.locale) }];
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

/**
 * "Nói thẳng" (HB-322, CONT-01 + UX-03): chỉ điều có nguồn (kế hoạch §8.2) — giá theo đêm, tiền hoàn tính
 * trên số đã trả, không đổi chỗ chéo giữa ga, Dorm là phòng chung.
 */
function Honestly({ pageKey, text }: CabinProps): ReactElement {
  const { t } = text;
  const lines = [
    t('guest.cabin.honest.nightly'),
    t('guest.cabin.honest.refund'),
    t('guest.cabin.honest.property'),
    ...(pageKey.code === 'DOR' ? [t('guest.cabin.honest.dorm')] : []),
  ];
  return (
    <section className="ph-honest" aria-labelledby="cabin-honest" data-testid="cabin-honest">
      <h2 id="cabin-honest">{t('guest.cabin.honestTitle')}</h2>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
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
            <JourneyCta
              page={{ kind: 'cabin', code: pageKey.code }}
              fallbackHref={ctaHref}
              label={t('guest.cabin.cta')}
              className="ph-btn ph-btn-accent ph-btn-lg"
              testId="cabin-cta"
              summary
            />
          </div>
          <SpecSheet {...props} />
        </header>
        <div className="ph-content-columns">
          <div className="ph-content-prose">
            {copy.description.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <h2 id="cabin-layout" className="ph-cabin-layout-title">
              {t('guest.cabin.layoutTitle')}
            </h2>
            <p data-testid="cabin-layout">{copy.layout}</p>
          </div>
          <StationsServed {...props} />
        </div>
        <Honestly {...props} />
        <PriceIncludes text={text} showDorm={pageKey.code === 'DOR'} linkDining />
        {gallery.length === 0 ? null : (
          <div className="ph-content-gallery">
            <GalleryGrid items={gallery} />
          </div>
        )}
      </div>
      <ClassCompare current={pageKey.code} text={text} />
      <StickyBookingStub
        title={title}
        page={{ kind: 'cabin', code: pageKey.code }}
        href={ctaHref}
        cta={t('guest.cabin.cta')}
      />
    </div>
  );
}
