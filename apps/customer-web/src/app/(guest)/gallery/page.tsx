/**
 * `/gallery` — thư viện ảnh toàn chuỗi (HB-311b, CONT-07, UX-07). Máy chủ dò file ảnh và dựng sẵn mục
 * (alt, link sang trang ga/hạng); bộ lọc chạy ở trình duyệt.
 */
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ChainPageHead, chainMetadata } from '../../../components/content/chain-page';
import { chainPagesCopy } from '@pinehill/content/chain-pages';
import { GALLERY_GROUPS, galleryEntries } from '@pinehill/content/gallery-entries';
import { landingContent } from '@pinehill/content/landing-content';
import { photoAlt, slotById } from '@pinehill/content/photo-slots';
import { serverTranslators } from '../../../i18n/server';
import { availablePhotos, photoSrcSet } from '../../../lib/photos';
import { GalleryBrowser, type BrowserItem } from './gallery-browser';

const PATH = '/gallery';

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await serverTranslators();
  return chainMetadata(PATH, locale, chainPagesCopy(locale).gallery);
}

export default async function GalleryPage(): Promise<ReactElement> {
  const text = await serverTranslators();
  const { t, locale } = text;
  const content = landingContent(locale);
  const entries = galleryEntries();
  const found = availablePhotos(entries.map((entry) => entry.id));
  const nameOf = (entry: (typeof entries)[number]): string =>
    entry.stationCode !== null
      ? t('guest.station.title', {
          name:
            content.stations.find((station) => station.code === entry.stationCode)?.name ??
            entry.stationCode,
        })
      : t('guest.cabin.title', {
          name:
            content.cabinClasses.find((cabin) => cabin.code === entry.classCode)?.name ??
            entry.classCode ??
            '',
        });
  const items: BrowserItem[] = entries.flatMap((entry) => {
    const slot = slotById(entry.id);
    const src = found[entry.id];
    if (slot === undefined || src === undefined) return [];
    return [
      {
        id: entry.id,
        src,
        srcSet: photoSrcSet(src),
        alt: photoAlt(slot, locale),
        shape: entry.shape,
        group: entry.group,
        stationCode: entry.stationCode,
        link: { href: entry.href, label: t('guest.gallery.goTo', { name: nameOf(entry) }) },
      },
    ];
  });
  return (
    <div>
      <ChainPageHead
        text={text}
        path={PATH}
        title={t('guest.chain.gallery.title')}
        lede={chainPagesCopy(locale).gallery.summary}
      >
        <GalleryBrowser
          items={items}
          stations={content.stations.map((station) => ({ code: station.code, name: station.name }))}
          groups={GALLERY_GROUPS.map((value) => ({
            value,
            label: t(`guest.chain.gallery.group.${value}`),
          }))}
        />
      </ChainPageHead>
    </div>
  );
}
