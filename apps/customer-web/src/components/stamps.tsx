/**
 * Thành phần dùng chung của customer-web (thế giới vé tàu): đọc ngày lịch, in số tiền, nhãn mã hạng phòng.
 * Chỉ trình bày dữ liệu có sẵn (ngày, giá, mã hạng phòng); không tự tính giá hay áp luật nghiệp vụ.
 */
import type { CSSProperties, ReactElement } from 'react';
import { formatMoney } from '@pinehill/ui-web';

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const;

export interface CalendarDay {
  readonly iso: string;
  readonly weekday: string;
  readonly dayMonth: string;
}

/** Đọc ngày lịch `YYYY-MM-DD` (không theo múi giờ máy) thành thứ + ngày/tháng để in lên tem. */
export function calendarDay(iso: string): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return null;
  const [, y, m, d] = match;
  const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(utc.getTime())) return null;
  return { iso, weekday: WEEKDAYS[utc.getUTCDay()] ?? '', dayMonth: `${d}/${m}` };
}

/** Các đêm của kỳ [checkIn, checkOut): ngày lịch nối tiếp, tối đa `limit` đêm để vẽ. */
export function stayNights(checkIn: string, checkOut: string): readonly string[] | null {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const nights: string[] = [];
  for (let at = start; at < end && nights.length < 60; at += 86_400_000) {
    nights.push(new Date(at).toISOString().slice(0, 10));
  }
  return nights;
}

/** Tem in số tiền: phần số lớn, ký hiệu ₫ nhỏ, chữ số đều để so cột. */
export function Denomination({
  amount,
  style,
}: {
  amount: number;
  style?: CSSProperties;
}): ReactElement {
  const text = formatMoney(amount);
  const [number, ...rest] = text.split(/\s+/);
  return (
    <span className="ph-denomination" style={style}>
      {number}
      {rest.length === 0 ? null : (
        <span style={{ fontSize: '0.55em', marginLeft: 2 }}>{rest.join(' ')}</span>
      )}
    </span>
  );
}

/** Tem nhỏ in mã hạng phòng và sức chứa: thay ảnh minh hoạ không có thật bằng dữ liệu có thật. */
export function RoomCodeStamp({
  code,
  capacityLabel,
  label,
}: {
  code: string;
  capacityLabel: string;
  label: string;
}): ReactElement {
  return (
    <span className="ph-room-code-wrap" role="img" aria-label={label}>
      <span className="ph-stamp ph-room-code" style={{ display: 'block' }}>
        <span className="ph-stamp-face">
          <b>{code}</b>
          <small>{capacityLabel}</small>
        </span>
      </span>
    </span>
  );
}
