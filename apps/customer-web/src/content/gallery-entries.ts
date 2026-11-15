/**
 * Thư viện ảnh toàn chuỗi (HB-311b, CONT-07): xếp mọi ô ảnh vào nhóm, ga và trang đích theo mã ô.
 * Ô chia sẻ mạng xã hội không vào thư viện. Ô chưa có file thì trang tự bỏ (như mọi gallery khác).
 */
import { ALL_PHOTO_SLOTS } from './photo-slots';
import { propertyPageByStation } from './property-pages';
import { isRoomTypeCode } from './room-type-codes';

export type GalleryGroup = 'poster' | 'room' | 'view' | 'class';
export const GALLERY_GROUPS: readonly GalleryGroup[] = ['poster', 'room', 'view', 'class'];

export interface GalleryEntry {
  readonly id: string;
  readonly group: GalleryGroup;
  /** Mã ga; `null` với ảnh hạng phòng (dùng chung toàn chuỗi). */
  readonly stationCode: string | null;
  /** Mã hạng với ảnh hạng phòng. */
  readonly classCode: string | null;
  /** Trang của ga hoặc hạng trong ảnh. */
  readonly href: string;
  /** Lưới nhiều tỉ lệ (UX-07): áp phích dọc, cảnh ngang. */
  readonly shape: 'tall' | 'wide' | null;
}

const STATION_SUFFIX: Readonly<Record<string, GalleryGroup>> = {
  poster: 'poster',
  phong: 'room',
  canh: 'view',
};

const SHAPES: Partial<Record<GalleryGroup, 'tall' | 'wide'>> = { poster: 'tall', view: 'wide' };

function stationEntry(id: string, code: string, suffix: string): GalleryEntry | null {
  const group = STATION_SUFFIX[suffix];
  const page = propertyPageByStation(code);
  if (group === undefined || page === undefined) return null;
  return {
    id,
    group,
    stationCode: code,
    classCode: null,
    href: `/stays/${page.slug}`,
    shape: SHAPES[group] ?? null,
  };
}

/** Một ô ảnh → mục thư viện; `null` nếu ô không thuộc thư viện. Thuần, để test. */
export function galleryEntry(id: string): GalleryEntry | null {
  const station = /^ga-([A-Z]{2})-([a-z]+)$/.exec(id);
  if (station !== null) return stationEntry(id, station[1] ?? '', station[2] ?? '');
  const code = /^hang-([A-Z]{3})$/.exec(id)?.[1] ?? '';
  if (!isRoomTypeCode(code)) return null;
  return {
    id,
    group: 'class',
    stationCode: null,
    classCode: code,
    href: `/room-types/${code}`,
    shape: null,
  };
}

export function galleryEntries(): readonly GalleryEntry[] {
  return ALL_PHOTO_SLOTS.flatMap((slot) => {
    const entry = galleryEntry(slot.id);
    return entry === null ? [] : [entry];
  });
}
