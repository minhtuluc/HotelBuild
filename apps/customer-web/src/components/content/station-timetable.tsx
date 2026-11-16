'use client';
/**
 * Bảng giờ ở tờ giới thiệu ga (DESIGN.md › Content Pages › Station Sheet): giờ nhận/trả phòng **lấy từ
 * API** công khai; độ cao, khí hậu, mùa đẹp từ nội dung tĩnh. Chưa có giờ (đang tải, lỗi, không khớp cơ
 * sở) thì in "--:--"; lỗi hoặc không khớp thêm một dòng dẫn sang bước tìm phòng: không đoán giờ.
 *
 * HB-325: phần gọi API (client hành trình, schema hợp đồng ~95 KB gzip) nạp động trong effect, sau khi trang
 * đã vẽ, để không tranh băng thông và luồng chính với ảnh đầu trang (LCP).
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { PropertyPublicSummary } from '@pinehill/contracts';
import { useT } from '../../i18n/client';

type Times =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly checkIn: string; readonly checkOut: string }
  | { readonly kind: 'unavailable' };

function timesFor(properties: readonly PropertyPublicSummary[], slug: string): Times {
  const property = properties.find((item) => item.slug === slug);
  return property === undefined
    ? { kind: 'unavailable' }
    : { kind: 'ready', checkIn: property.checkInTime, checkOut: property.checkOutTime };
}

export interface TimetableFact {
  readonly label: string;
  readonly value: string;
}

export function StationTimetable({
  title,
  slug,
  facts,
}: {
  title: string;
  /** Slug của trang ga, khớp `slug` của cơ sở do API công khai trả (HB-311). */
  slug: string;
  facts: readonly TimetableFact[];
}): ReactElement {
  const t = useT();
  const [times, setTimes] = useState<Times>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    const load = (): void => {
      import('../../app/(guest)/search/public-properties')
        .then(({ fetchPublicProperties }) => fetchPublicProperties(window.location.origin))
        .then(
          (properties) => {
            if (live) setTimes(timesFor(properties, slug));
          },
          () => {
            if (live) setTimes({ kind: 'unavailable' });
          },
        );
    };
    // Sau sự kiện `load`: giờ nhận/trả là phần phụ của đầu trang, không được tranh với ảnh đầu trang (HB-325).
    if (document.readyState === 'complete') load();
    else window.addEventListener('load', load, { once: true });
    return () => {
      live = false;
      window.removeEventListener('load', load);
    };
  }, [slug]);
  const time = (pick: 'checkIn' | 'checkOut'): string => {
    if (times.kind === 'ready') return times[pick];
    return t('guest.station.timePending');
  };
  return (
    <section className="ph-timetable" aria-label={title} data-testid="station-timetable">
      <p className="ph-timetable-head" aria-hidden="true">
        {title}
      </p>
      <dl>
        <div>
          <dt>{t('guest.station.checkIn')}</dt>
          <dd
            key={times.kind}
            className={times.kind === 'ready' ? 'ph-timetable-time ph-tick' : 'ph-timetable-time'}
            data-testid="station-check-in"
          >
            {time('checkIn')}
          </dd>
        </div>
        <div>
          <dt>{t('guest.station.checkOut')}</dt>
          <dd
            key={times.kind}
            className={times.kind === 'ready' ? 'ph-timetable-time ph-tick' : 'ph-timetable-time'}
            data-testid="station-check-out"
          >
            {time('checkOut')}
          </dd>
        </div>
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {times.kind === 'unavailable' ? (
        <p className="ph-timetable-note" data-testid="station-times-note">
          {t('guest.station.timeUnavailable')}
        </p>
      ) : null}
    </section>
  );
}
