/**
 * Thân tờ giới thiệu ga (HB-310). Component máy chủ; chỉ bảng giờ (đọc API) và gallery (lightbox) chạy ở
 * trình duyệt. Thông số ga lấy từ nội dung trang chủ để hai nơi nói cùng một câu.
 */
import type { ReactElement } from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../../../../components/content/breadcrumbs';
import { GalleryGrid, type GalleryItem } from '../../../../components/content/gallery-grid';
import { JsonLd, breadcrumbList } from '../../../../components/content/json-ld';
import { RouteMap } from '../../../../components/content/route-map';
import { StationTimetable } from '../../../../components/content/station-timetable';
import { StickyBookingStub } from '../../../../components/content/sticky-booking-stub';
import { Photo } from '../../../../components/photo';
import { POSTERS } from '../../../../components/station-posters';
import { landingContent, type Station } from '../../../../content/landing-content';
import { photoAlt, slotById } from '../../../../content/photo-slots';
import {
  propertyPageByStation,
  type PropertyPageCopy,
  type PropertyPageKey,
} from '../../../../content/property-pages';
import { roomTypePageKey } from '../../../../content/room-type-pages';
import type { Translators } from '../../../../i18n/translate';
import { availablePhotos } from '../../../../lib/photos';
import { absoluteUrl } from '../../../../lib/site';

interface SheetProps {
  readonly pageKey: PropertyPageKey;
  readonly copy: PropertyPageCopy;
  readonly station: Station;
  readonly text: Translators;
  readonly ctaHref: string;
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

function stationHref(code: string): string {
  const page = propertyPageByStation(code);
  return page === undefined ? `/#ga-${code}` : `/stays/${page.slug}`;
}

function SheetHead({ pageKey, copy, station, text, ctaHref }: SheetProps): ReactElement {
  const { t } = text;
  const Poster = POSTERS[station.code];
  const found = availablePhotos([pageKey.posterPhotoId]);
  return (
    <header className="ph-content-head">
      <div className="ph-content-head-copy">
        <Breadcrumbs
          label={t('guest.content.breadcrumb')}
          items={[
            { label: t('guest.content.home'), href: '/' },
            { label: t('guest.content.stations'), href: '/#tuyen' },
            { label: station.name },
          ]}
        />
        <p className="ph-content-code" aria-hidden="true">
          {station.code}
        </p>
        <h1 className="ph-content-title">{t('guest.station.title', { name: station.name })}</h1>
        <p className="ph-content-kind">{station.kind}</p>
        <p className="ph-content-lede">{copy.summary}</p>
        <Link href={ctaHref} className="ph-btn ph-btn-accent ph-btn-lg" data-testid="station-cta">
          {t('guest.station.cta')}
        </Link>
      </div>
      <figure className="ph-poster ph-content-poster">
        <Photo
          slot={slotById(pageKey.posterPhotoId)}
          locale={text.locale}
          src={found[pageKey.posterPhotoId]}
          preview={false}
          fallback={Poster === undefined ? undefined : <Poster />}
          className="ph-poster-art"
          eager
        />
      </figure>
    </header>
  );
}

function RoomsAtStation({ pageKey, station, text, ctaHref }: SheetProps): ReactElement {
  const { t } = text;
  const classes = landingContent(text.locale).cabinClasses.filter((cabin) =>
    pageKey.featuredRoomCodes.some((code) => code === cabin.code),
  );
  return (
    <section className="ph-band ph-band-ticket" aria-labelledby="station-rooms">
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="station-rooms">{t('guest.station.roomsTitle', { name: station.name })}</h2>
        </header>
        <ul className="ph-classes">
          {classes.map((cabin) => (
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
                  {t('guest.cabin.readMore', { name: cabin.name })} →
                </Link>
              )}
            </li>
          ))}
        </ul>
        <div className="ph-actions ph-content-end">
          <Link href={ctaHref} className="ph-btn ph-btn-accent ph-btn-lg">
            {t('guest.station.cta')}
          </Link>
        </div>
      </div>
    </section>
  );
}

export function StationSheet(props: SheetProps): ReactElement {
  const { pageKey, copy, station, text, ctaHref } = props;
  const { t } = text;
  const stations = landingContent(text.locale).stations;
  const gallery = galleryItems(pageKey.galleryIds, text);
  const path = `/stays/${pageKey.slug}`;
  return (
    <div className="ph-has-stub">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Hotel',
          name: t('guest.station.title', { name: station.name }),
          description: copy.summary,
          url: absoluteUrl(path),
          address: {
            '@type': 'PostalAddress',
            addressLocality: station.name,
            addressCountry: 'VN',
          },
        }}
      />
      <JsonLd
        data={breadcrumbList([
          { name: t('guest.content.home'), url: absoluteUrl('/') },
          { name: station.name, url: absoluteUrl(path) },
        ])}
      />
      <div className="ph-page-shell ph-content-shell">
        <SheetHead {...props} />
        <StationTimetable
          title={t('guest.station.timetable', { name: station.name })}
          apiNameIncludes={pageKey.apiNameIncludes}
          facts={[
            { label: t('guest.route.altitude'), value: station.altitude },
            { label: t('guest.route.climate'), value: station.climate },
            { label: t('guest.route.best'), value: station.bestMonths },
          ]}
        />
        <RouteMap
          stations={stations}
          label={t('guest.route.title')}
          hrefFor={stationHref}
          current={station.code}
        />
      </div>
      <section className="ph-band ph-band-paper" aria-labelledby="station-story">
        <div className="ph-band-inner ph-content-columns">
          <div className="ph-content-prose">
            <h2 id="station-story">{t('guest.station.storyTitle')}</h2>
            {copy.story.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <p className="ph-station-note">{station.note}</p>
          </div>
          <aside className="ph-arrival" aria-labelledby="station-arrival">
            <h2 id="station-arrival">{t('guest.station.arrivalTitle')}</h2>
            <ul>
              {copy.arrival.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </aside>
        </div>
        {gallery.length === 0 ? null : (
          <div className="ph-band-inner ph-content-gallery">
            <h2 id="station-gallery">{t('guest.station.galleryTitle')}</h2>
            <GalleryGrid items={gallery} />
          </div>
        )}
      </section>
      <RoomsAtStation {...props} />
      <StickyBookingStub
        title={t('guest.station.title', { name: station.name })}
        href={ctaHref}
        cta={t('guest.station.cta')}
      />
    </div>
  );
}
