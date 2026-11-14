/**
 * `/room-types/[code]` — hạng khoang (HB-310, DESIGN.md › Content Pages › Cabin Class).
 *
 * Trang nội dung dùng chung toàn chuỗi (quyết định Q3), khác `/rooms/[roomTypeId]` (SCR-03, cần cơ sở và
 * ngày). Chỉ in thông số có nguồn; giá luôn ở bước tìm phòng, theo từng đêm. Mã không có trang thì 404.
 */
import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { landingContent } from '../../../../content/landing-content';
import { photoAlt, slotById } from '../../../../content/photo-slots';
import {
  ROOM_TYPE_PAGES,
  roomTypePageCopy,
  roomTypePageKey,
} from '../../../../content/room-type-pages';
import { serverTranslators } from '../../../../i18n/server';
import { absoluteUrl, openGraphImage } from '../../../../lib/site';
import { CabinSheet } from './cabin-sheet';

export const dynamicParams = false;

export function generateStaticParams(): { code: string }[] {
  return ROOM_TYPE_PAGES.map((page) => ({ code: page.code }));
}

type Params = Promise<{ code: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { code } = await params;
  const { locale } = serverTranslators();
  const key = roomTypePageKey(code);
  const copy = key === undefined ? undefined : roomTypePageCopy(key.code, locale);
  if (key === undefined || copy === undefined) return {};
  const photo = slotById(key.photoId);
  const path = `/room-types/${key.code}`;
  return {
    title: copy.seoTitle,
    description: copy.seoDescription,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: {
      title: copy.seoTitle,
      description: copy.seoDescription,
      url: absoluteUrl(path),
      images: photo === undefined ? [] : openGraphImage(photo.id, photoAlt(photo, locale)),
    },
  };
}

export default async function CabinPage({ params }: { params: Params }): Promise<ReactElement> {
  const { code } = await params;
  const text = serverTranslators();
  const key = roomTypePageKey(code);
  const copy = key === undefined ? undefined : roomTypePageCopy(key.code, text.locale);
  const cabin = landingContent(text.locale).cabinClasses.find((item) => item.code === key?.code);
  if (key === undefined || copy === undefined || cabin === undefined) notFound();
  return <CabinSheet pageKey={key} copy={copy} cabin={cabin} text={text} />;
}
