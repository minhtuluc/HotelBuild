'use client';
/**
 * Nút chọn nhanh số đêm trên vé tìm phòng (HB-317, FEAT-03): một chạm điền ngày trả theo 2 / 3 / 5 đêm từ
 * ngày nhận đang chọn. Nhãn trung tính, không hứa mức giảm; ô ngày vẫn chọn tự do như cũ.
 */
import type { ReactElement } from 'react';
import { useT } from '../../../i18n/client';
import { activeQuickNights, QUICK_NIGHTS, withNights } from './journey-context';
import { businessDate, type SearchDraft } from './search-model';

export function QuickNights({
  draft,
  onPick,
}: {
  draft: SearchDraft;
  onPick: (next: SearchDraft) => void;
}): ReactElement {
  const t = useT();
  const active = activeQuickNights(draft);
  return (
    <div
      role="group"
      aria-label={t('guest.search.quickNights')}
      className="ph-quick-nights ph-tfield-wide"
      data-testid="quick-nights"
    >
      {QUICK_NIGHTS.map((nights) => (
        <button
          key={nights}
          type="button"
          className="ph-quick-night"
          aria-pressed={active === nights}
          onClick={() => {
            onPick(withNights(draft, nights, businessDate(new Date())));
          }}
        >
          {t('guest.search.quickNight', { nights })}
        </button>
      ))}
    </div>
  );
}
