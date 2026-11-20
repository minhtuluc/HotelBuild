/**
 * Ô ảnh: có ảnh thật thì in ảnh; chưa có thì dùng `fallback` (vd. tranh SVG) hoặc ẩn;
 * ở chế độ xem trước (`?anh=1`) thì vẽ khung ô ảnh kèm mã, tỉ lệ, kích thước và việc cần chụp.
 */
import type { ReactElement, ReactNode } from 'react';
import { photoAlt, type PhotoSlot } from '@pinehill/content/photo-slots';
import type { Locale } from '../i18n/locales';

/** Ảnh thật của ô: ảnh gốc làm `src`; có bản nhỏ thì thêm `srcSet` + `sizes` (HB-325). */
function PhotoImage({
  slot,
  alt,
  src,
  srcSet,
  sizes,
  className,
  priority,
}: {
  slot: PhotoSlot;
  alt: string;
  src: string;
  srcSet: string | undefined;
  sizes: string | undefined;
  className: string | undefined;
  priority: boolean;
}): ReactElement {
  return (
    <img
      className={`ph-photo ${className ?? ''}`}
      src={src}
      srcSet={srcSet}
      sizes={srcSet === undefined ? undefined : sizes}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      // Ảnh LCP không giải mã trễ (HB-325): `async` có thể hoãn lần vẽ đầu của ảnh đầu trang.
      decoding={priority ? 'auto' : 'async'}
      style={{ aspectRatio: slot.ratio }}
    />
  );
}

export function Photo({
  slot,
  locale,
  src,
  preview,
  fallback,
  className,
  eager,
  srcSet,
  sizes,
}: {
  slot: PhotoSlot | undefined;
  locale: Locale;
  src: string | undefined;
  preview: boolean;
  fallback?: ReactNode | undefined;
  className?: string | undefined;
  /** Ảnh LCP (đầu trang ga): tải ngay, ưu tiên cao thay vì `lazy`. */
  eager?: boolean | undefined;
  /** Bản nhỏ của ảnh (HB-325, `photoSrcSet` phía máy chủ); không có thì chỉ dùng ảnh gốc. */
  srcSet?: string | undefined;
  /** Bề rộng hiển thị để trình duyệt chọn bản trong `srcSet`. */
  sizes?: string | undefined;
}): ReactElement | null {
  if (slot === undefined) return fallback === undefined ? null : <>{fallback}</>;
  if (src !== undefined)
    return (
      <PhotoImage
        slot={slot}
        alt={photoAlt(slot, locale)}
        src={src}
        srcSet={srcSet}
        sizes={sizes}
        className={className}
        priority={eager === true}
      />
    );
  if (preview) {
    return (
      <div
        className={`ph-photo-slot ${className ?? ''}`}
        style={{ aspectRatio: slot.ratio }}
        data-testid={`photo-slot-${slot.id}`}
      >
        <strong>{slot.id}</strong>
        <span>
          {slot.ratio.replace('/', ':')} · ≥ {slot.minSize}
        </span>
        <small>{slot.brief}</small>
      </div>
    );
  }
  return fallback === undefined ? null : <>{fallback}</>;
}
