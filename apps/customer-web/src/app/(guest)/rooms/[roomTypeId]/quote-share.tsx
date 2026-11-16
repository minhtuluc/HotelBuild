'use client';
/**
 * Chia sẻ và in báo giá SCR-03 (HB-317, FEAT-06). Link sao chép mang đủ tiêu chí và gói giá đang xem;
 * người nhận mở link thì máy chủ báo giá lại tại lúc mở (không gửi báo giá cũ, không gửi số tiền qua URL).
 * In dùng `window.print()` với bản in A4 ở `globals.css` (`@media print`).
 */
import { useState, type ReactElement } from 'react';
import type { RatePlanCode } from '@pinehill/contracts';
import { useT } from '../../../../i18n/client';
import { criteriaQuery } from '../../search/search-params';
import type { StayCriteria } from '../../search/journey-api';

/** Đường dẫn chia sẻ: trang hiện tại + tiêu chí + gói giá. Thuần, để test. */
export function shareUrl(
  location: { readonly origin: string; readonly pathname: string },
  criteria: StayCriteria,
  planCode: RatePlanCode | '',
): string {
  const query = criteriaQuery(criteria);
  if (planCode !== '') query.set('ratePlanCode', planCode);
  return `${location.origin}${location.pathname}?${query.toString()}`;
}

export function QuoteShare({
  criteria,
  planCode,
}: {
  criteria: StayCriteria;
  planCode: RatePlanCode | '';
}): ReactElement {
  const t = useT();
  const [note, setNote] = useState<'ok' | 'failed' | null>(null);
  return (
    <div className="ph-quote-share" data-print="hide">
      <div className="ph-actions">
        <button
          type="button"
          className="ph-btn"
          data-testid="quote-copy-link"
          onClick={() => {
            const url = shareUrl(window.location, criteria, planCode);
            void navigator.clipboard
              .writeText(url)
              .then(() => {
                setNote('ok');
              })
              .catch(() => {
                setNote('failed');
              });
          }}
        >
          {t('guest.rooms.copyLink')}
        </button>
        <button
          type="button"
          className="ph-btn"
          data-testid="quote-print"
          onClick={() => {
            window.print();
          }}
        >
          {t('guest.rooms.print')}
        </button>
      </div>
      <p
        role="status"
        aria-live="polite"
        data-testid="quote-copy-note"
        style={{ margin: 0, fontSize: 13 }}
      >
        {note === null
          ? ''
          : t(note === 'ok' ? 'guest.rooms.copyLink.ok' : 'guest.rooms.copyLink.failed')}
      </p>
    </div>
  );
}
