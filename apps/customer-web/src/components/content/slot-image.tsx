/**
 * Ảnh của một ô ảnh trong thẻ nội dung (HB-326): máy chủ dò file và bản nhỏ; chưa có file thì không vẽ gì
 * (thẻ vẫn đủ chữ), đúng quy tắc "ô chưa có ảnh tự ẩn". Ảnh luôn `lazy` vì không nằm ở đầu trang.
 */
import type { ReactElement } from 'react';
import { slotById } from '../../content/photo-slots';
import type { Locale } from '../../i18n/locales';
import { photoSrc, photoSrcSet } from '../../lib/photos';
import { Photo } from '../photo';

export function SlotImage({
  id,
  locale,
  sizes,
  className,
}: {
  id: string;
  locale: Locale;
  /** Bề rộng hiển thị để trình duyệt chọn bản nhỏ. */
  sizes: string;
  className?: string;
}): ReactElement | null {
  const slot = slotById(id);
  const src = photoSrc(id) ?? undefined;
  if (slot === undefined || src === undefined) return null;
  return (
    <Photo
      slot={slot}
      locale={locale}
      src={src}
      srcSet={photoSrcSet(src)}
      sizes={sizes}
      preview={false}
      className={className}
    />
  );
}
