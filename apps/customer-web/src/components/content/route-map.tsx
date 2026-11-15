/**
 * Sơ đồ tuyến: ba ga trên một đường, độ cao ghi cạnh mỗi ga. Dùng ở trang chủ (link về dải ga) và trang
 * ga (ga đang xem có `aria-current="page"`, chấm đặc đỏ dấu bấm).
 */
import type { ReactElement } from 'react';
import type { Station } from '../../content/landing-content';
import { LocaleLink } from '../locale-link';

export function RouteMap({
  stations,
  label,
  hrefFor,
  current,
  sync = false,
}: {
  stations: readonly Station[];
  label: string;
  hrefFor: (code: string) => string;
  current?: string | undefined;
  /** Gắn `data-sync="station"` để nổi viền cùng thẻ ga (UX-02, HB-323). */
  sync?: boolean;
}): ReactElement {
  return (
    <ol className="ph-route" aria-label={label}>
      {stations.map((station) => (
        <li
          key={station.code}
          className="ph-route-stop"
          data-sync={sync ? 'station' : undefined}
          data-code={sync ? station.code : undefined}
        >
          <LocaleLink
            href={hrefFor(station.code)}
            aria-current={station.code === current ? 'page' : undefined}
          >
            <span className="ph-route-dot" aria-hidden="true" />
            <span className="ph-route-code">{station.code}</span>
            <span className="ph-route-name">{station.name}</span>
            <span className="ph-route-meta">{station.altitude}</span>
          </LocaleLink>
        </li>
      ))}
    </ol>
  );
}
