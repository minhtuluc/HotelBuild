/**
 * Bảng so sánh năm hạng (HB-323, FEAT-05) trên trang hạng. Chỉ thuộc tính có nguồn: tên, khoang, sức chứa
 * (nội dung trang chủ khớp seed), số chỗ ngủ (seed `bedCount`), bán theo phòng hay giường (Dorm bán theo
 * giường), hợp với ai (câu chữ trang hạng). Không diện tích, không phòng tắm riêng/chung (chưa có nguồn).
 * Component máy chủ.
 */
import type { ReactElement } from 'react';
import { landingContent } from '../../content/landing-content';
import {
  ROOM_TYPE_PAGES,
  roomTypePageCopy,
  type RoomTypeCode,
} from '../../content/room-type-pages';
import type { Locale } from '../../i18n/locales';
import type { Translators } from '../../i18n/translate';
import { LocaleLink as Link } from '../locale-link';

export interface CompareRow {
  readonly code: RoomTypeCode;
  readonly name: string;
  readonly cabin: string;
  readonly capacity: string;
  readonly sleeps: number;
  readonly soldBy: 'room' | 'bed';
  readonly suits: string;
}

/** Dòng so sánh theo thứ tự hạng của trang chủ. Thuần, để test. */
export function classCompareRows(locale: Locale): readonly CompareRow[] {
  return landingContent(locale).cabinClasses.flatMap((cabin) => {
    const page = ROOM_TYPE_PAGES.find((item) => item.code === cabin.code);
    if (page === undefined) return [];
    return [
      {
        code: page.code,
        name: cabin.name,
        cabin: cabin.cabin,
        capacity: cabin.capacity,
        sleeps: page.sleeps,
        soldBy: page.code === 'DOR' ? 'bed' : 'room',
        suits: roomTypePageCopy(page.code, locale)?.suits ?? '',
      },
    ];
  });
}

export function ClassCompare({
  current,
  text,
}: {
  current: RoomTypeCode;
  text: Translators;
}): ReactElement {
  const { t } = text;
  const rows = classCompareRows(text.locale);
  return (
    <section data-reveal className="ph-band ph-band-ticket" aria-labelledby="cabin-compare">
      <div className="ph-band-inner">
        <header className="ph-section-head">
          <h2 id="cabin-compare">{t('guest.cabin.compareTitle')}</h2>
        </header>
        <table className="ph-compare" data-testid="class-compare">
          <thead>
            <tr>
              <th scope="col">{t('guest.cabin.compare.class')}</th>
              <th scope="col">{t('guest.cabin.compare.cabin')}</th>
              <th scope="col">{t('guest.cabin.compare.capacity')}</th>
              <th scope="col">{t('guest.cabin.compare.sleeps')}</th>
              <th scope="col">{t('guest.cabin.compare.soldBy')}</th>
              <th scope="col">{t('guest.cabin.compare.suits')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isCurrent = row.code === current;
              return (
                <tr
                  key={row.code}
                  aria-current={isCurrent ? 'true' : undefined}
                  data-testid={`compare-${row.code}`}
                >
                  <th scope="row">
                    <span className="ph-compare-code">{row.code}</span>{' '}
                    {isCurrent ? (
                      <>
                        <span>{row.name}</span>{' '}
                        <span className="ph-compare-current">
                          {t('guest.cabin.compare.current')}
                        </span>
                      </>
                    ) : (
                      <Link href={`/room-types/${row.code}`}>{row.name}</Link>
                    )}
                  </th>
                  <td data-label={t('guest.cabin.compare.cabin')}>{row.cabin}</td>
                  <td data-label={t('guest.cabin.compare.capacity')}>{row.capacity}</td>
                  <td data-label={t('guest.cabin.compare.sleeps')} className="ph-compare-num">
                    {row.sleeps}
                  </td>
                  <td data-label={t('guest.cabin.compare.soldBy')}>
                    {row.soldBy === 'bed'
                      ? t('guest.cabin.compare.byBed')
                      : t('guest.cabin.compare.byRoom')}
                  </td>
                  <td data-label={t('guest.cabin.compare.suits')}>{row.suits}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
