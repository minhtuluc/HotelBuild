/**
 * Gói nội dung tĩnh của một locale thêm sau (HB-313): trang chủ, trang ga, trang hạng phòng, alt ảnh, trang ẩm thực và khối "Giá đã gồm" (HB-318). `vi` và
 * `en` giữ ở chỗ cũ (`landing-content*.ts`, `COPY` trong từng file trang); locale mới gom vào một file để
 * người duyệt bản dịch đọc một chỗ.
 *
 * Phần tả nơi chốn là MINH HOẠ (`illustrative: true`), phần chính sách dịch từ docs/02 và cần người bản ngữ
 * duyệt trước ngày phát hành công khai (quyết định Q6). Mã gói, số tiền, mốc giờ giữ nguyên.
 */
import type { Locale } from '../../i18n/locales';
import type { DiningPageCopy, IncludedCopy } from '../dining-page';
import type { LandingContent } from '../landing-content';
import type { PropertyPageCopy } from '../property-pages';
import type { RoomTypeCode, RoomTypePageCopy } from '../room-type-pages';

export type PackLocale = Exclude<Locale, 'vi' | 'en'>;

/** Phần trang ga + trang hạng của gói, ở tệp `<locale>-pages.ts` riêng (HB-311). */
export type LocalePagesCopy = Pick<LocaleContentPack, 'properties' | 'roomTypes'>;

export interface LocaleContentPack {
  readonly landing: LandingContent;
  /** Theo slug trang ga. */
  readonly properties: Readonly<Record<string, PropertyPageCopy>>;
  readonly roomTypes: Partial<Readonly<Record<RoomTypeCode, RoomTypePageCopy>>>;
  /** Alt ảnh theo mã ô ảnh (`photo-slots.ts`); test `locale-packs.spec.ts` bắt đủ mọi ô. */
  readonly photoAlts: Readonly<Record<string, string>>;
  /** Trang `/dining` (HB-318). */
  readonly dining: DiningPageCopy;
  /** Khối "Giá đã gồm" theo `docs/02-nghiep-vu/tien-nghi-trong-gia.md` (HB-318). */
  readonly included: IncludedCopy;
}
