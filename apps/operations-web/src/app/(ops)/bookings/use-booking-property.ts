'use client';
/**
 * Ô "Cơ sở" của SCR-31 (TD-44, HB-320): đọc danh sách cơ sở máy chủ trả cho phiên rồi chốt cơ sở lọc
 * bằng `bookingPropertyFilter` (URL > cơ sở đang làm việc > tất cả). Không đọc được danh sách thì chỉ còn
 * "Tất cả cơ sở"; phạm vi thật vẫn do máy chủ giới hạn.
 */
import { useEffect, useState } from 'react';
import { createPropertyApi, type ApiClient } from '@pinehill/api-client';
import type { PropertySummary } from '@pinehill/contracts';
import { useWorkingPropertyId } from '../../../session/staff-session';
import { ALL_PROPERTIES, bookingPropertyFilter } from './bookings-model';

export interface BookingProperty {
  readonly properties: readonly PropertySummary[];
  /** Cơ sở lọc hoặc `ALL_PROPERTIES`; `null` khi chưa đọc xong danh sách (chưa tải booking). */
  readonly property: string | null;
  /** Giá trị ô chọn: như `property`, khi đang đọc thì `ALL_PROPERTIES`. */
  readonly selected: string;
  /** Khoá dựng lại form lọc (ô chọn không điều khiển) khi cơ sở lọc hoặc danh sách đổi. */
  readonly formKey: string;
}

export function useBookingProperty(
  client: ApiClient,
  enabled: boolean,
  requested: string,
): BookingProperty {
  const working = useWorkingPropertyId();
  const [properties, setProperties] = useState<readonly PropertySummary[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    createPropertyApi(client)
      .list()
      .then(
        (page) => {
          if (live) setProperties(page.data.data);
        },
        () => {
          if (live) setProperties([]);
        },
      );
    return () => {
      live = false;
    };
  }, [client, enabled]);
  if (properties === null)
    return { properties: [], property: null, selected: ALL_PROPERTIES, formKey: 'loading' };
  const property = bookingPropertyFilter(requested, properties, working);
  return { properties, property, selected: property, formKey: `${property}:${properties.length}` };
}
