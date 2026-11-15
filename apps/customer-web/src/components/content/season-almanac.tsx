'use client';
/**
 * Lịch mùa tại ga (HB-322, FEAT-02): bốn mùa, thời tiết minh hoạ, không nhãn mùa giá (Q14). Trang dựng tĩnh
 * nên "hôm nay" chỉ biết ở trình duyệt: sau khi tải mới đánh dấu mùa hiện tại và đổi nút thành link cuối tuần
 * gần nhất trong mùa (thứ Sáu → Chủ nhật, giờ VN). Trước đó nút về khối tìm phòng với ga chọn sẵn.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { addDays, businessDate } from '../../app/(guest)/search/search-model';
import { useT } from '../../i18n/client';
import { LocaleLink as Link } from '../locale-link';

export interface AlmanacSeason {
  readonly months: readonly number[];
  /** Nhãn tháng đã định dạng ở máy chủ (vd. "Tháng 11 – tháng 12"). */
  readonly label: string;
  readonly name: string;
  readonly weather: string;
  readonly tip: string;
}

const FRIDAY = 5;
/** Đủ để gặp mọi tháng trong năm, kể cả khi mùa bắt đầu ngay sau hôm nay một năm. */
const SEARCH_DAYS = 400;

/** Cuối tuần (thứ Sáu → Chủ nhật) gần nhất từ hôm nay có ngày nhận rơi vào tháng của mùa. Thuần, để test. */
export function nextWeekendIn(
  months: readonly number[],
  today: string,
): { readonly checkIn: string; readonly checkOut: string } | null {
  for (let offset = 0; offset < SEARCH_DAYS; offset += 1) {
    const day = addDays(today, offset);
    const date = new Date(`${day}T00:00:00Z`);
    if (date.getUTCDay() === FRIDAY && months.includes(date.getUTCMonth() + 1)) {
      return { checkIn: day, checkOut: addDays(day, 2) };
    }
  }
  return null;
}

/** Vị trí mùa chứa tháng `month` (1–12); -1 nếu không mùa nào chứa. */
export function seasonIndexFor(
  seasons: readonly { readonly months: readonly number[] }[],
  month: number,
): number {
  return seasons.findIndex((season) => season.months.includes(month));
}

/** Link cuối tuần: về khối tìm phòng, ga và ngày điền sẵn (HB-317 đọc truy vấn này). */
export function weekendHref(
  slug: string,
  weekend: { checkIn: string; checkOut: string } | null,
): string {
  const ga = `ga=${encodeURIComponent(slug)}`;
  return weekend === null
    ? `/?${ga}#search-block`
    : `/?${ga}&checkIn=${weekend.checkIn}&checkOut=${weekend.checkOut}#search-block`;
}

export function SeasonAlmanac({
  slug,
  seasons,
}: {
  slug: string;
  seasons: readonly AlmanacSeason[];
}): ReactElement {
  const t = useT();
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(businessDate(new Date()));
  }, []);
  const current = today === null ? -1 : seasonIndexFor(seasons, Number(today.slice(5, 7)));
  return (
    <ol className="ph-almanac" data-testid="season-almanac">
      {seasons.map((season, index) => {
        const isNow = index === current;
        const href = weekendHref(slug, today === null ? null : nextWeekendIn(season.months, today));
        return (
          <li
            key={season.label}
            className="ph-almanac-season"
            data-current={isNow ? 'true' : undefined}
            data-testid={`season-${index}`}
          >
            <p className="ph-almanac-months">
              {season.label}
              {isNow ? (
                <span className="ph-almanac-now">{t('guest.station.season.now')}</span>
              ) : null}
            </p>
            <h3 className="ph-almanac-name">{season.name}</h3>
            <p className="ph-almanac-weather">{season.weather}</p>
            <p className="ph-almanac-tip">{season.tip}</p>
            <Link
              href={href}
              className="ph-almanac-cta"
              data-testid={`season-cta-${index}`}
              aria-label={`${t('guest.station.season.cta')}: ${season.name}`}
            >
              {t('guest.station.season.cta')}{' '}
              <span className="ph-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
