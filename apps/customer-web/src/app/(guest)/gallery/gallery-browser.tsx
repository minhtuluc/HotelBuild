'use client';
/**
 * Bộ lọc thư viện ảnh (HB-311b, CONT-07): hai nhóm nút bật/tắt (`aria-pressed`) theo ga và theo nhóm ảnh.
 * Trang máy chủ đã dựng sẵn mọi mục (ảnh, alt, link); ở đây chỉ lọc. Không có JS thì vẫn thấy đủ ảnh.
 */
import { useState, type ReactElement } from 'react';
import { GalleryGrid, type GalleryItem } from '../../../components/content/gallery-grid';
import type { GalleryGroup } from '@pinehill/content/gallery-entries';
import { useT } from '../../../i18n/client';

export interface BrowserItem extends GalleryItem {
  readonly group: GalleryGroup;
  readonly stationCode: string | null;
}

interface Choice<T extends string> {
  readonly value: T | null;
  readonly label: string;
}

/** Lọc thuần, để test: `null` là "Tất cả". Ảnh hạng phòng không thuộc ga nào nên rơi khỏi bộ lọc ga. */
export function filterGallery<T extends { group: GalleryGroup; stationCode: string | null }>(
  items: readonly T[],
  station: string | null,
  group: GalleryGroup | null,
): readonly T[] {
  return items.filter(
    (item) =>
      (station === null || item.stationCode === station) &&
      (group === null || item.group === group),
  );
}

function ChoiceRow<T extends string>({
  label,
  choices,
  value,
  onPick,
  testId,
}: {
  label: string;
  choices: readonly Choice<T>[];
  value: T | null;
  onPick: (next: T | null) => void;
  testId: string;
}): ReactElement {
  return (
    <div role="group" aria-label={label} className="ph-gallery-filter" data-testid={testId}>
      <span className="ph-gallery-filter-label" aria-hidden="true">
        {label}
      </span>
      {choices.map((choice) => (
        <button
          key={choice.value ?? 'all'}
          type="button"
          className="ph-quick-night"
          aria-pressed={choice.value === value}
          onClick={() => onPick(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function GalleryBrowser({
  items,
  stations,
  groups,
}: {
  items: readonly BrowserItem[];
  stations: readonly { readonly code: string; readonly name: string }[];
  groups: readonly { readonly value: GalleryGroup; readonly label: string }[];
}): ReactElement {
  const t = useT();
  const [station, setStation] = useState<string | null>(null);
  const [group, setGroup] = useState<GalleryGroup | null>(null);
  const shown = filterGallery(items, station, group);
  const all = t('guest.chain.gallery.all');
  return (
    <div className="ph-gallery-browser">
      <div className="ph-gallery-filters">
        <ChoiceRow
          label={t('guest.chain.gallery.byStation')}
          choices={[
            { value: null, label: all },
            ...stations.map((item) => ({ value: item.code, label: item.name })),
          ]}
          value={station}
          onPick={setStation}
          testId="gallery-filter-station"
        />
        <ChoiceRow
          label={t('guest.chain.gallery.byGroup')}
          choices={[{ value: null, label: all }, ...groups]}
          value={group}
          onPick={setGroup}
          testId="gallery-filter-group"
        />
      </div>
      <p className="ph-gallery-count" aria-live="polite" data-testid="gallery-count">
        {shown.length === 0
          ? t('guest.chain.gallery.empty')
          : t('guest.chain.gallery.count', { n: shown.length })}
      </p>
      <GalleryGrid key={`${station ?? 'all'}-${group ?? 'all'}`} items={shown} dense />
    </div>
  );
}
