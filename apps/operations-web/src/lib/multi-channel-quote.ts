/**
 * SCR-30 — so sánh giá đa kênh (UC-RATE-05, BR-RATE-07,08,09,17): phần thuần kiểm được bằng vitest.
 * Màn hình **chỉ hiển thị** con số máy chủ trả (gộp/hoa hồng/thuần) và cảnh báo trong `warnings[]`;
 * không tự nhân hệ số, không tự so sánh số để sinh cảnh báo (sai 1 VND là lỗi — BR-RATE-17).
 */
import type { ChannelCode, MultiChannelQuote, MultiChannelQuoteRequest } from '@pinehill/contracts';

/** 7 kênh canonical theo thứ tự bảng BR-RATE-07 (`channelCodeSchema` — không chép giá trị khác). */
export const ALL_CHANNELS: readonly ChannelCode[] = [
  'WEB',
  'PHONE',
  'WALKIN',
  'AGENCY',
  'OTA_BOOKING',
  'OTA_AGODA',
  'OTA_AIRBNB',
];

export interface FieldIssue {
  field: string;
  issue: string;
}

/** Khoảng ngày phải có ít nhất một đêm (`checkOut` sau `checkIn`). */
export function rangeIssue(checkIn: string, checkOut: string): FieldIssue | null {
  if (checkIn === '') return { field: 'checkIn', issue: 'REQUIRED' };
  if (checkOut === '') return { field: 'checkOut', issue: 'REQUIRED' };
  return checkOut <= checkIn ? { field: 'checkOut', issue: 'BEFORE_START' } : null;
}

/** Chọn kênh để so sánh; bỏ chọn hết thì dùng **cả 7 kênh** (mặc định của backend, HB-062 AC4). */
export function channelsFor(selected: readonly ChannelCode[]): readonly ChannelCode[] {
  return selected.length === 0 ? ALL_CHANNELS : selected;
}

export function buildRequest(input: {
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  selectedChannels: readonly ChannelCode[];
}): MultiChannelQuoteRequest {
  return {
    roomTypeId: input.roomTypeId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    channelCodes: [...channelsFor(input.selectedChannels)],
  };
}

export function toggleChannel(
  selected: readonly ChannelCode[],
  code: ChannelCode,
): readonly ChannelCode[] {
  return selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code];
}

/** `true` khi máy chủ đánh dấu kênh này có cảnh báo (giao diện không tự suy — BR-RATE-09). */
export function hasServerWarning(option: MultiChannelQuote['options'][number]): boolean {
  return option.warnings.length > 0;
}
