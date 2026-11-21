/**
 * Khối "Giá đã gồm" (HB-318, UX-03): đối chiếu thứ đã gồm và chưa gồm trong giá phòng, theo điều khoản
 * `docs/02-nghiep-vu/tien-nghi-trong-gia.md`. Component máy chủ, không có giá: chỉ nói giá đã báo gồm gì.
 */
import type { ReactElement } from 'react';
import { includedCopy } from '@pinehill/content/dining-page';
import type { Translators } from '../../i18n/translate';
import { LocaleLink as Link } from '../locale-link';

interface PriceIncludesProps {
  readonly text: Translators;
  /** Có hiện mục thêm cho Dorm không (trang hạng chỉ hiện khi đúng hạng DOR). */
  readonly showDorm: boolean;
  /** Hiện link sang trang ẩm thực (tắt khi đang ở chính trang đó). */
  readonly linkDining: boolean;
}

export function PriceIncludes({ text, showDorm, linkDining }: PriceIncludesProps): ReactElement {
  const { t } = text;
  const copy = includedCopy(text.locale);
  return (
    <section className="ph-includes" aria-labelledby="price-includes" data-testid="price-includes">
      <h2 id="price-includes">{t('guest.includes.title')}</h2>
      <div className="ph-includes-cols">
        <div>
          <h3>{t('guest.includes.all')}</h3>
          <ul className="ph-includes-yes">
            {copy.included.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {showDorm ? (
            <>
              <h3>{t('guest.includes.dorm')}</h3>
              <ul className="ph-includes-yes">
                {copy.dorm.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <div>
          <h3>{t('guest.includes.excluded')}</h3>
          <ul className="ph-includes-no">
            {copy.excluded.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="ph-includes-note">{t('guest.includes.note')}</p>
          {linkDining ? (
            <Link href="/dining" className="ph-includes-link">
              {t('guest.includes.more')}{' '}
              <span className="ph-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
