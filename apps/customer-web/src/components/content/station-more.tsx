/** Ga đã có tờ giới thiệu thì thêm link "Đọc thêm"; ga chưa có trang thì không có link (HB-310). */
import type { ReactElement } from 'react';
import { LocaleLink as Link } from '../locale-link';
import { propertyPageByStation } from '../../content/property-pages';
import { serverTranslators } from '../../i18n/server';

export async function StationMore({
  code,
  name,
}: {
  code: string;
  name: string;
}): Promise<ReactElement | null> {
  const { t } = await serverTranslators();
  const page = propertyPageByStation(code);
  if (page === undefined) return null;
  return (
    <Link className="ph-station-more" href={`/stays/${page.slug}`}>
      {t('guest.station.readMore', { name })}{' '}
      <span className="ph-arrow" aria-hidden="true">
        →
      </span>
    </Link>
  );
}
