/**
 * Bảng chặng đến ga (HB-322, UX-05): cột thời gian ước lượng, cột tả chặng. Dùng ở trang ga và
 * `/getting-here` (HB-311b). Component máy chủ.
 */
import type { ReactElement } from 'react';
import type { ArrivalLeg } from '@pinehill/content/property-pages';
import type { Translators } from '../../i18n/translate';

export function LegsTable({
  legs,
  text,
  testId,
}: {
  legs: readonly ArrivalLeg[];
  text: Translators;
  testId?: string;
}): ReactElement {
  const { t } = text;
  return (
    <table className="ph-legs" data-testid={testId}>
      <thead>
        <tr>
          <th scope="col">{t('guest.station.legsTime')}</th>
          <th scope="col">{t('guest.station.legsRoute')}</th>
        </tr>
      </thead>
      <tbody>
        {legs.map((leg) => (
          <tr key={leg.route}>
            <th scope="row" className="ph-legs-time">
              {leg.time}
            </th>
            <td>{leg.route}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
