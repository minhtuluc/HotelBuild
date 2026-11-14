'use client';
/**
 * Bảng giờ ở tờ giới thiệu ga (DESIGN.md › Content Pages › Station Sheet): giờ nhận/trả phòng **lấy từ
 * API** công khai; độ cao, khí hậu, mùa đẹp từ nội dung tĩnh. Chưa có giờ (đang tải, lỗi, không khớp cơ
 * sở) thì in "--:--"; lỗi hoặc không khớp thêm một dòng dẫn sang bước tìm phòng: không đoán giờ.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { PropertyPublicSummary } from '@pinehill/contracts';
import { useT } from '../../i18n/client';
import { fetchPublicProperties } from '../../app/(guest)/search/public-properties';

type Times =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly checkIn: string; readonly checkOut: string }
  | { readonly kind: 'unavailable' };

function timesFor(properties: readonly PropertyPublicSummary[], apiNameIncludes: string): Times {
  const property = properties.find((item) => item.name.includes(apiNameIncludes));
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
  apiNameIncludes,
  facts,
}: {
  title: string;
  apiNameIncludes: string;
  facts: readonly TimetableFact[];
}): ReactElement {
  const t = useT();
  const [times, setTimes] = useState<Times>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    fetchPublicProperties(window.location.origin).then(
      (properties) => {
        if (live) setTimes(timesFor(properties, apiNameIncludes));
      },
      () => {
        if (live) setTimes({ kind: 'unavailable' });
      },
    );
    return () => {
      live = false;
    };
  }, [apiNameIncludes]);
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
