/**
 * Ô ảnh: có ảnh thật thì in ảnh; chưa có thì dùng `fallback` (vd. tranh SVG) hoặc ẩn;
 * ở chế độ xem trước (`?anh=1`) thì vẽ khung ô ảnh kèm mã, tỉ lệ, kích thước và việc cần chụp.
 */
import type { ReactElement, ReactNode } from 'react';
import { photoAlt, type PhotoSlot } from '../content/photo-slots';
import type { Locale } from '../i18n/locales';

export function Photo({
  slot,
  locale,
  src,
  preview,
  fallback,
  className,
}: {
  slot: PhotoSlot | undefined;
  locale: Locale;
  src: string | undefined;
  preview: boolean;
  fallback?: ReactNode | undefined;
  className?: string | undefined;
}): ReactElement | null {
  if (slot === undefined) return fallback === undefined ? null : <>{fallback}</>;
  if (src !== undefined) {
    return (
      <img
        className={`ph-photo ${className ?? ''}`}
        src={src}
        alt={photoAlt(slot, locale)}
        loading="lazy"
        decoding="async"
        style={{ aspectRatio: slot.ratio }}
      />
    );
  }
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
