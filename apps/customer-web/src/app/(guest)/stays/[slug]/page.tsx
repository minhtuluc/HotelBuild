/**
 * `/stays/[slug]` — tờ giới thiệu ga (HB-310, DESIGN.md › Content Pages › Station Sheet).
 *
 * Trang nội dung, không phải bước đặt phòng: không có giá, tồn hay mốc huỷ. Giờ nhận/trả phòng lấy từ API
 * công khai (bảng giờ); CTA về khối tìm phòng trang chủ với ga chọn sẵn. Slug không có trang thì 404.
 */
import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  PROPERTY_PAGES,
  propertyPageCopy,
  propertyPageKey,
  searchCtaHref,
} from '../../../../content/property-pages';
import { landingContent } from '../../../../content/landing-content';
import { photoAlt, slotById } from '../../../../content/photo-slots';
import { serverTranslators } from '../../../../i18n/server';
import { absoluteUrl, openGraphImage } from '../../../../lib/site';
import { StationSheet } from './station-sheet';

/** Chỉ các slug có nội dung; slug khác trả 404 thay vì dựng trang rỗng. */
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return PROPERTY_PAGES.map((page) => ({ slug: page.slug }));
}

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const { locale } = serverTranslators();
  const key = propertyPageKey(slug);
  const copy = propertyPageCopy(slug, locale);
  if (key === undefined || copy === undefined) return {};
  const poster = slotById(key.posterPhotoId);
  const path = `/stays/${key.slug}`;
  return {
    title: copy.seoTitle,
    description: copy.seoDescription,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: {
      title: copy.seoTitle,
      description: copy.seoDescription,
      url: absoluteUrl(path),
      images: poster === undefined ? [] : openGraphImage(poster.id, photoAlt(poster, locale)),
    },
  };
}

export default async function StationPage({ params }: { params: Params }): Promise<ReactElement> {
  const { slug } = await params;
  const text = serverTranslators();
  const key = propertyPageKey(slug);
  const copy = propertyPageCopy(slug, text.locale);
  const station = landingContent(text.locale).stations.find(
    (item) => item.code === key?.stationCode,
  );
  if (key === undefined || copy === undefined || station === undefined) notFound();
  return (
    <StationSheet
      pageKey={key}
      copy={copy}
      station={station}
      text={text}
      ctaHref={searchCtaHref(key.slug)}
    />
  );
}
