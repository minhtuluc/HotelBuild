/**
 * `/dining` — ăn uống ở ga (HB-318, CONT-04, chủ dự án quyết P4: giữ trang, nội dung minh hoạ).
 *
 * Trang nội dung toàn chuỗi: quầy ăn sáng, góc trà ở sảnh, gợi ý quán quanh từng ga, và khối "Giá đã gồm".
 * Không có giá món; thứ đã gồm / gọi riêng theo điều khoản `docs/02-nghiep-vu/tien-nghi-trong-gia.md`.
 */
import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { diningPageCopy } from '@pinehill/content/dining-page';
import { LOCALE_META } from '../../../i18n/locales';
import { localeAlternates } from '../../../i18n/seo';
import { serverTranslators } from '../../../i18n/server';
import { DiningSheet } from './dining-sheet';

const PATH = '/dining';

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await serverTranslators();
  const copy = diningPageCopy(locale);
  const alternates = localeAlternates(PATH, locale);
  return {
    title: copy.seoTitle,
    description: copy.seoDescription,
    alternates,
    openGraph: {
      title: copy.seoTitle,
      description: copy.seoDescription,
      url: alternates.canonical,
      locale: LOCALE_META[locale].ogLocale,
    },
  };
}

export default async function DiningPage(): Promise<ReactElement> {
  const text = await serverTranslators();
  return <DiningSheet text={text} copy={diningPageCopy(text.locale)} path={PATH} />;
}
