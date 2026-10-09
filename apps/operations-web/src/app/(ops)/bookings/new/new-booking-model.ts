/**
 * SCR-33 + SCR-34 (HB-107) — tạo booking tại quầy / qua điện thoại: phần thuần, kiểm bằng vitest.
 *
 * Luồng **≤ 5 bước** (khách vãng lai nhập nhanh) và giá chỉ lấy từ **báo giá** máy chủ trả. `holdMinutes`
 * của kênh PHONE là dữ liệu cấu hình máy chủ (`GET /channels`) chứ không phải luật cứng ở giao diện.
 */
import { ratePlanCodeSchema } from '@pinehill/contracts';
import type {
  BookingCreateRequest,
  ChannelSummary,
  GuestSummary,
  Quote,
  QuoteRequest,
  RatePlanCode,
} from '@pinehill/contracts';

/** Hai kênh tạo tại quầy/điện thoại (BR-CHAN): vãng lai đi bộ và đặt qua điện thoại. */
export type CounterChannel = 'WALKIN' | 'PHONE';

export const COUNTER_CHANNELS: readonly CounterChannel[] = ['WALKIN', 'PHONE'];

export const STEPS = ['channel', 'room', 'guest', 'confirm', 'done'] as const;

export type Step = (typeof STEPS)[number];

export function nextStep(step: Step): Step {
  const index = STEPS.indexOf(step);
  return STEPS[Math.min(index + 1, STEPS.length - 1)] ?? 'done';
}

export function previousStep(step: Step): Step {
  const index = STEPS.indexOf(step);
  return STEPS[Math.max(index - 1, 0)] ?? 'channel';
}

export interface GuestDraft {
  readonly fullName: string;
  readonly phone: string;
}

export interface NewBookingDraft {
  readonly channel: CounterChannel;
  readonly propertyId: string;
  readonly roomTypeId: string;
  /** `''` = chưa chọn gói (mã gói công bố, kiểm bằng schema khi chọn). */
  readonly ratePlanCode: RatePlanCode | '';
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly roomCount: number;
  readonly guest: GuestDraft;
}

export const EMPTY_DRAFT: NewBookingDraft = {
  channel: 'WALKIN',
  propertyId: '',
  roomTypeId: '',
  ratePlanCode: '',
  checkIn: '',
  checkOut: '',
  adults: 2,
  children: 0,
  roomCount: 1,
  guest: { fullName: '', phone: '' },
};

export type StepIssue = 'PROPERTY' | 'DATES' | 'ROOM' | 'NAME' | 'PHONE';

/** Số đêm giữa hai mốc; `null` khi mốc không hợp lệ hoặc ngoài 1…365 đêm. */
export function nightsBetween(checkIn: string, checkOut: string): number | null {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const nights = (end - start) / 86_400_000;
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) return null;
  return nights;
}

/** Lỗi của **bước đang đứng** — chặn tại chỗ, không gọi API khi thiếu dữ liệu. */
export function stepIssue(step: Step, draft: NewBookingDraft): StepIssue | null {
  if (step === 'channel') return draft.propertyId.trim() === '' ? 'PROPERTY' : null;
  if (step === 'room') {
    if (nightsBetween(draft.checkIn, draft.checkOut) === null) return 'DATES';
    return draft.roomTypeId.trim() === '' || draft.ratePlanCode === '' ? 'ROOM' : null;
  }
  if (step === 'guest') {
    if (draft.guest.fullName.trim() === '') return 'NAME';
    return /^(?:\+84|0)\d{9}$/.test(draft.guest.phone.replace(/\s/g, '')) ? null : 'PHONE';
  }
  return null;
}

/** Báo giá cho **đúng kênh** đang tạo (WALKIN/PHONE) — giá hiển thị theo quote, không tự tính. */
export function quoteRequestOf(draft: NewBookingDraft): QuoteRequest | null {
  const nights = nightsBetween(draft.checkIn, draft.checkOut);
  if (nights === null || draft.ratePlanCode === '') return null;
  return {
    propertyId: draft.propertyId,
    roomTypeId: draft.roomTypeId,
    channelCode: draft.channel,
    ratePlanCode: draft.ratePlanCode,
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    adults: draft.adults,
    children: draft.children,
    roomCount: draft.roomCount,
  };
}

export function bookingRequestOf(
  draft: NewBookingDraft,
  quoteId: string,
): BookingCreateRequest | null {
  const nights = nightsBetween(draft.checkIn, draft.checkOut);
  if (nights === null || draft.ratePlanCode === '') return null;
  return {
    propertyId: draft.propertyId,
    roomTypeId: draft.roomTypeId,
    channelCode: draft.channel,
    ratePlanCode: draft.ratePlanCode,
    quoteId,
    guest: { fullName: draft.guest.fullName.trim(), phone: draft.guest.phone.trim() },
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    adults: draft.adults,
    children: draft.children,
    roomCount: draft.roomCount,
  };
}

/** Kênh theo mã trong danh sách máy chủ trả (nơi giữ `holdMinutes`). */
export function channelOf(
  channels: readonly ChannelSummary[],
  code: CounterChannel,
): ChannelSummary | undefined {
  return channels.find((channel) => channel.code === code);
}

/** Số phút giữ chỗ của kênh PHONE (cấu hình máy chủ); `null` khi kênh chưa khai. */
export function holdMinutesOf(
  channels: readonly ChannelSummary[],
  code: CounterChannel,
): number | null {
  return channelOf(channels, code)?.holdMinutes ?? null;
}

/** Khách tra theo SĐT (SCR-34): khớp đã chuẩn hoá `0…`/`84…`/`+84…`. */
export function guestByPhone(
  guests: readonly GuestSummary[],
  phone: string,
): GuestSummary | undefined {
  const digits = phone.replace(/\D/g, '').replace(/^84/, '0');
  return guests.find((guest) => guest.phone.replace(/\D/g, '').replace(/^84/, '0') === digits);
}

export interface DepositView {
  readonly percent: number;
  readonly amount: number;
}

/** Tiền cọc hiển thị: nguyên văn tỉ lệ và số tiền của báo giá máy chủ trả. */
export function depositOf(quote: Quote): DepositView {
  return { percent: quote.depositPercent, amount: quote.depositAmount };
}

/** Mã gói do ô chọn gửi lên: chỉ nhận khi **đúng** là mã gói công bố (không đoán). */
export function planCodeOf(value: string): RatePlanCode | null {
  const parsed = ratePlanCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
