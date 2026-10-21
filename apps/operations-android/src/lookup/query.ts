/**
 * SCR-62 — phân loại chuỗi tra cứu thành kế hoạch gọi hai tuyến đọc hiện có
 * (`GET /bookings?q=`, `GET /guests?q=`). Thuần, không gọi mạng, không sao chép luật nghiệp vụ:
 * việc chuẩn hoá SĐT/khớp mã vẫn do máy chủ quyết (`api.md` §1.5, BR-CRM-01).
 */
export type LookupKind = 'empty' | 'invalid' | 'code' | 'phone' | 'name';

export interface LookupQuery {
  readonly kind: LookupKind;
  readonly raw: string;
  /** Chuỗi đã chuẩn hoá để gửi đi; rỗng khi `empty`. */
  readonly value: string;
  /** SĐT dạng canonical `+84XXXXXXXXX` khi người dùng nhập đủ 10 số. */
  readonly phone: string | null;
}

export interface SearchPlan {
  /** `q` gửi `/guests`; `null` = không cần gọi tuyến này. */
  readonly guests: string | null;
  /** `q` gửi `/bookings`; `null` = không cần gọi tuyến này. */
  readonly bookings: string | null;
}

const FULL_PHONE = /^(?:\+84|84|0)\d{9}$/;
const CODE = /^PH-?(\d{0,6})(?:-?([A-Z0-9]{0,6}))?$/;

/** `+84…` khi đủ 10 số; `null` khi chuỗi chưa đủ/không phải SĐT. */
export function normalizePhoneValue(raw: string): string | null {
  const compact = raw.replaceAll(/[\s().-]/g, '');
  if (!FULL_PHONE.test(compact)) return null;
  if (compact.startsWith('0')) return `+84${compact.slice(1)}`;
  if (compact.startsWith('84')) return `+${compact}`;
  return compact;
}

/**
 * Mã booking lưu ở dạng `PH-YYMMDD-XXXXX`; người dùng hay gõ thiếu dấu gạch, có dấu cách hoặc
 * chỉ một phần. Dựng lại dấu gạch để `contains` của máy chủ còn khớp.
 */
function canonicalCode(squeezed: string): string {
  const compact = squeezed.toUpperCase();
  const match = CODE.exec(compact);
  if (match === null) return compact;
  const seq = match[1] ?? '';
  const tail = match[2] ?? '';
  return ['PH', seq, tail].filter((part) => part.length > 0).join('-');
}

export function parseLookupQuery(raw: string): LookupQuery {
  const value = raw.trim().replaceAll(/\s+/g, ' ');
  if (value === '') return { kind: 'empty', raw, value: '', phone: null };
  if (value.length < 2) return { kind: 'invalid', raw, value, phone: null };
  const squeezed = value.replaceAll(/\s+/g, '');
  if (/^PH/i.test(squeezed))
    return { kind: 'code', raw, value: canonicalCode(squeezed), phone: null };
  const phone = normalizePhoneValue(value);
  if (/^\+?\d[\d\s().-]*$/.test(value))
    return { kind: 'phone', raw, value: phone ?? squeezed, phone };
  return { kind: 'name', raw, value, phone: null };
}

/** SĐT một phần: bỏ số 0 đầu để khớp `phone` đã chuẩn hoá `+84…` bằng `contains`. */
function guestPhoneTerm(query: LookupQuery): string {
  if (query.phone !== null) return query.phone;
  const digits = query.value.replaceAll(/\D/g, '');
  return digits.startsWith('0') ? `+84${digits.slice(1)}` : digits;
}

export function searchPlan(query: LookupQuery): SearchPlan {
  switch (query.kind) {
    case 'code':
      return { guests: null, bookings: query.value };
    case 'phone':
      return {
        guests: guestPhoneTerm(query),
        bookings: query.phone ?? query.value.replaceAll(/\D/g, ''),
      };
    case 'name':
      return { guests: query.value, bookings: null };
    case 'empty':
    case 'invalid':
      return { guests: null, bookings: null };
  }
}
