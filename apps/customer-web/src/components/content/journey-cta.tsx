'use client';
/**
 * Nút chính của trang nội dung giữ ngữ cảnh hành trình (HB-317, FEAT-01). Trang tĩnh dựng sẵn ở máy chủ nên
 * nút render bản mặc định trước; sau khi tải, đọc truy vấn URL của chính trang:
 * - trang hạng: đủ tiêu chí (cơ sở, ngày, khách) thì dẫn thẳng về kết quả tìm phòng cùng kỳ;
 * - trang ga: có ngày thì về khối tìm phòng, ga theo trang đang xem, ngày và khách điền sẵn
 *   (`propertyId` trên URL có thể là ga khác nên bỏ qua).
 * Không có ngữ cảnh hợp lệ thì giữ nút mặc định. Ngữ cảnh chỉ nằm trên URL.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { draftFromUrl } from '../../app/(guest)/search/journey-context';
import { criteriaQuery, parseCriteria } from '../../app/(guest)/search/search-params';
import { useLocale, useT } from '../../i18n/client';
import { calendarDate } from '../../i18n/format';
import { LocaleLink as Link } from '../locale-link';

export type JourneyKind =
  | { readonly kind: 'cabin'; readonly code: string }
  | { readonly kind: 'station'; readonly slug: string };

interface Target {
  readonly href: string;
  readonly from: string;
  readonly to: string;
  readonly nights: number;
  readonly adults: number;
  readonly children: number;
}

function nightsBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Đích theo ngữ cảnh URL; `null` khi không có ngữ cảnh hợp lệ. Thuần, để test. */
export function journeyTarget(page: JourneyKind, search: string): Target | null {
  const params = new URLSearchParams(search);
  if (page.kind === 'cabin') {
    const criteria = parseCriteria(params);
    if (criteria === null) return null;
    return {
      href: `/search?${criteriaQuery(criteria).toString()}`,
      from: criteria.checkIn,
      to: criteria.checkOut,
      nights: nightsBetween(criteria.checkIn, criteria.checkOut),
      adults: criteria.adults,
      children: criteria.children,
    };
  }
  const draft = draftFromUrl(params);
  if (draft.checkIn === undefined || draft.checkOut === undefined) return null;
  const query = new URLSearchParams({
    ga: page.slug,
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
  });
  if (draft.adults !== undefined) query.set('adults', draft.adults);
  if (draft.children !== undefined) query.set('children', draft.children);
  return {
    href: `/?${query.toString()}#search-block`,
    from: draft.checkIn,
    to: draft.checkOut,
    nights: nightsBetween(draft.checkIn, draft.checkOut),
    adults: Number(draft.adults ?? 2),
    children: Number(draft.children ?? 0),
  };
}

export function JourneyCta({
  page,
  fallbackHref,
  label,
  className,
  testId,
  summary = false,
}: {
  page: JourneyKind;
  fallbackHref: string;
  label: string;
  className: string;
  testId?: string;
  /** In dòng tóm tắt kỳ dưới nút (đầu trang); cuống vé dính đáy thì không. */
  summary?: boolean;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const pageKey = page.kind === 'cabin' ? page.code : page.slug;
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => {
    setTarget(
      journeyTarget(
        page.kind === 'cabin'
          ? { kind: 'cabin', code: pageKey }
          : { kind: 'station', slug: pageKey },
        window.location.search,
      ),
    );
  }, [page.kind, pageKey]);
  return (
    <>
      <Link href={target?.href ?? fallbackHref} className={className} data-testid={testId}>
        {target === null ? label : t('guest.journey.cta')}
      </Link>
      {summary && target !== null ? (
        <p className="ph-journey-summary" data-testid="journey-summary">
          {t('guest.booking.stay.summary', {
            from: calendarDate(target.from, locale),
            to: calendarDate(target.to, locale),
            stay: t('format.stayPeriod', {
              nights: target.nights,
              adults: target.adults,
              children: target.children,
            }),
          })}
        </p>
      ) : null}
    </>
  );
}
