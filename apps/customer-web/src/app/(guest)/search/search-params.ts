/**
 * SCR-02 — phần thuần: đọc kỳ tìm phòng từ truy vấn URL (SCR-01 gửi sang) và dựng liên kết sang SCR-03.
 * Thiếu/sai tham số thì màn hình hướng dẫn quay lại trang chủ thay vì gọi API.
 */
import type { StayCriteria } from './journey-api';

export interface FieldIssue {
  readonly field: string;
  readonly issue: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function positiveInt(
  value: string | null,
  min: number,
  max: number,
  fallback?: number,
): number | null {
  if (value === null || value.trim() === '') return fallback ?? null;
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function isoDate(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return ISO_DATE.test(trimmed) ? trimmed : null;
}

/** `null` khi truy vấn thiếu/sai trường bắt buộc (màn hình hiện hướng dẫn, không gọi API). */
export function parseCriteria(params: URLSearchParams): StayCriteria | null {
  const propertyId = params.get('propertyId')?.trim() ?? '';
  const checkIn = isoDate(params.get('checkIn'));
  const checkOut = isoDate(params.get('checkOut'));
  const adults = positiveInt(params.get('adults'), 1, 20);
  const children = positiveInt(params.get('children'), 0, 20, 0);
  const roomCount = positiveInt(params.get('roomCount'), 1, 10, 1);
  if (
    propertyId === '' ||
    checkIn === null ||
    checkOut === null ||
    adults === null ||
    children === null ||
    roomCount === null
  ) {
    return null;
  }
  if (Date.parse(`${checkOut}T00:00:00Z`) <= Date.parse(`${checkIn}T00:00:00Z`)) return null;
  return { propertyId, checkIn, checkOut, adults, children, roomCount };
}

/** Truy vấn giữ nguyên kỳ khi mở SCR-03 cho một loại phòng. */
export function criteriaQuery(criteria: StayCriteria): URLSearchParams {
  return new URLSearchParams({
    propertyId: criteria.propertyId,
    checkIn: criteria.checkIn,
    checkOut: criteria.checkOut,
    adults: String(criteria.adults),
    children: String(criteria.children),
    roomCount: String(criteria.roomCount),
  });
}

export function detailHref(criteria: StayCriteria, roomTypeId: string): string {
  return `/rooms/${encodeURIComponent(roomTypeId)}?${criteriaQuery(criteria).toString()}`;
}

/** Kỳ được coi là hợp lệ khi có cơ sở và ít nhất một đêm (dùng cho thông báo hướng dẫn). */
export function criteriaIssue(params: URLSearchParams): FieldIssue {
  const checkIn = params.get('checkIn')?.trim() ?? '';
  const checkOut = params.get('checkOut')?.trim() ?? '';
  if (
    params.get('propertyId')?.trim() !== '' &&
    ISO_DATE.test(checkIn) &&
    ISO_DATE.test(checkOut)
  ) {
    return { field: 'checkOut', issue: 'BEFORE_START' };
  }
  return { field: 'propertyId', issue: 'REQUIRED' };
}
