/** HB-062: phần thuần SCR-30 — chọn kênh, thân lệnh xem báo giá, kiểm kỳ lưu trú. */
import { describe, expect, it } from 'vitest';
import type { MultiChannelQuote } from '@pinehill/contracts';
import {
  ALL_CHANNELS,
  buildRequest,
  channelsFor,
  hasServerWarning,
  rangeIssue,
  toggleChannel,
} from '../src/lib/multi-channel-quote';

describe('channelsFor / toggleChannel', () => {
  it('bỏ chọn hết thì dùng mặc định cả 7 kênh (đúng mặc định backend)', () => {
    expect(ALL_CHANNELS).toHaveLength(7);
    expect(channelsFor([])).toEqual(ALL_CHANNELS);
    expect(channelsFor(['WEB'])).toEqual(['WEB']);
  });

  it('bật/tắt kênh giữ nguyên thứ tự người dùng chọn', () => {
    expect(toggleChannel([], 'WEB')).toEqual(['WEB']);
    expect(toggleChannel(['WEB', 'PHONE'], 'WEB')).toEqual(['PHONE']);
  });
});

describe('rangeIssue', () => {
  it('bắt buộc ngày và phải có ít nhất một đêm', () => {
    expect(rangeIssue('', '2026-12-27')).toEqual({ field: 'checkIn', issue: 'REQUIRED' });
    expect(rangeIssue('2026-12-24', '')).toEqual({ field: 'checkOut', issue: 'REQUIRED' });
    expect(rangeIssue('2026-12-27', '2026-12-24')).toEqual({
      field: 'checkOut',
      issue: 'BEFORE_START',
    });
    expect(rangeIssue('2026-12-24', '2026-12-24')).toEqual({
      field: 'checkOut',
      issue: 'BEFORE_START',
    });
    expect(rangeIssue('2026-12-24', '2026-12-27')).toBeNull();
  });
});

describe('buildRequest', () => {
  it('gửi mã kênh canonical và mặc định đủ 7 khi chưa chọn', () => {
    const request = buildRequest({
      roomTypeId: 'rt1',
      checkIn: '2026-12-24',
      checkOut: '2026-12-27',
      selectedChannels: [],
    });
    expect(request.channelCodes).toEqual([...ALL_CHANNELS]);
    // Không có mã sai chính tả kiểu `WALK_IN` (enum canonical là `WALKIN`).
    expect(request.channelCodes).toContain('WALKIN');
    expect(request.channelCodes).not.toContain('WALK_IN');
  });
});

describe('hasServerWarning', () => {
  it('chỉ dựa vào warnings[] của máy chủ, không tự so sánh số', () => {
    const option = (warnings: string[]): MultiChannelQuote['options'][number] => ({
      channelCode: 'OTA_BOOKING',
      nightlyFrom: 1_500_000,
      totalFrom: 4_500_000,
      netTotal: 3_690_000,
      warnings,
    });
    expect(hasServerWarning(option(['Giá thuần thấp hơn WEB']))).toBe(true);
    expect(hasServerWarning(option([]))).toBe(false);
  });
});
