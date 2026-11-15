import { describe, expect, it } from 'vitest';
import {
  activeQuickNights,
  draftFromUrl,
  mergeDraft,
  urlParams,
  withNights,
} from '../../src/app/(guest)/search/journey-context';
import { initialPropertyId } from '../../src/app/(guest)/search/public-properties';
import { classHref } from '../../src/app/(guest)/search/search-params';
import type { SearchDraft } from '../../src/app/(guest)/search/search-model';
import { journeyTarget } from '../../src/components/content/journey-cta';
import { shareUrl } from '../../src/app/(guest)/rooms/[roomTypeId]/quote-share';

/** HB-317 — giữ ngữ cảnh hành trình trên URL (FEAT-01), chọn nhanh số đêm (FEAT-03), link chia sẻ (FEAT-06). */

const BASE: SearchDraft = {
  propertyId: '',
  checkIn: '2026-12-01',
  checkOut: '2026-12-02',
  adults: '2',
  children: '0',
};

const CRITERIA = {
  propertyId: 'p-vt',
  checkIn: '2026-12-24',
  checkOut: '2026-12-27',
  adults: 2,
  children: 1,
  roomCount: 1,
};

describe('đọc ngữ cảnh từ URL', () => {
  it('nhận ngày lịch hợp lệ, số khách trong khoảng, id gọn', () => {
    const params = new URLSearchParams(
      'propertyId=p-vt&checkIn=2026-12-24&checkOut=2026-12-27&adults=3&children=1',
    );
    expect(draftFromUrl(params)).toEqual({
      propertyId: 'p-vt',
      checkIn: '2026-12-24',
      checkOut: '2026-12-27',
      adults: '3',
      children: '1',
    });
  });

  it('bỏ giá trị sai, không đoán: ngày không có thật, trả trước nhận, khách ngoài khoảng, id lạ', () => {
    expect(draftFromUrl(new URLSearchParams('checkIn=2026-02-30&adults=0&children=9'))).toEqual({});
    expect(draftFromUrl(new URLSearchParams('checkIn=2026-12-24&checkOut=2026-12-24'))).toEqual({
      checkIn: '2026-12-24',
    });
    expect(draftFromUrl(new URLSearchParams('propertyId=<script>&adults=11'))).toEqual({});
  });

  it('ghép lên bản nháp mặc định; có ngày nhận mà thiếu ngày trả thì trả hôm sau', () => {
    expect(mergeDraft(BASE, {})).toEqual(BASE);
    expect(mergeDraft(BASE, { checkIn: '2026-12-24', adults: '4' })).toEqual({
      ...BASE,
      checkIn: '2026-12-24',
      checkOut: '2026-12-25',
      adults: '4',
    });
  });

  it('searchParams của trang máy chủ: khoá lặp lại bị bỏ', () => {
    const params = urlParams({ ga: 'da-lat', checkIn: ['a', 'b'], adults: undefined });
    expect(params.toString()).toBe('ga=da-lat');
  });

  it('cơ sở gợi ý theo id chỉ nhận id có trong danh sách máy chủ trả', () => {
    const list = [
      { id: 'p-vt', name: 'A', slug: 'vung-tau', checkInTime: '14:00', checkOutTime: '12:00' },
      { id: 'p-dl', name: 'B', slug: 'da-lat', checkInTime: '14:00', checkOutTime: '12:00' },
    ];
    expect(initialPropertyId(list, undefined, 'p-dl')).toBe('p-dl');
    expect(initialPropertyId(list, 'da-lat', 'khong-co')).toBe('p-dl');
    expect(initialPropertyId(list, undefined, 'khong-co')).toBe('p-vt');
  });
});

describe('chọn nhanh số đêm', () => {
  it('giữ ngày nhận đang chọn, đặt ngày trả theo số đêm', () => {
    expect(withNights({ ...BASE, checkIn: '2026-12-24' }, 3, '2026-11-15')).toMatchObject({
      checkIn: '2026-12-24',
      checkOut: '2026-12-27',
    });
  });

  it('ngày nhận trống, sai hoặc đã qua thì lấy hôm nay (giờ VN do nơi gọi truyền)', () => {
    expect(withNights({ ...BASE, checkIn: '' }, 2, '2026-11-15')).toMatchObject({
      checkIn: '2026-11-15',
      checkOut: '2026-11-17',
    });
    expect(withNights({ ...BASE, checkIn: '2026-11-01' }, 5, '2026-11-15')).toMatchObject({
      checkIn: '2026-11-15',
      checkOut: '2026-11-20',
    });
  });

  it('đánh dấu nút đang khớp số đêm của bản nháp', () => {
    expect(activeQuickNights({ ...BASE, checkIn: '2026-12-24', checkOut: '2026-12-27' })).toBe(3);
    expect(
      activeQuickNights({ ...BASE, checkIn: '2026-12-24', checkOut: '2026-12-28' }),
    ).toBeNull();
  });
});

describe('nút chính của trang nội dung', () => {
  it('trang hạng: đủ tiêu chí thì dẫn thẳng về kết quả cùng kỳ', () => {
    const search = new URL(classHref(CRITERIA, 'DLX'), 'http://x').search;
    const target = journeyTarget({ kind: 'cabin', code: 'DLX' }, search);
    expect(target?.href).toBe(
      '/search?propertyId=p-vt&checkIn=2026-12-24&checkOut=2026-12-27&adults=2&children=1&roomCount=1',
    );
    expect(target).toMatchObject({ nights: 3, adults: 2, children: 1 });
  });

  it('trang ga: ga theo trang đang xem, bỏ propertyId trên URL', () => {
    const target = journeyTarget(
      { kind: 'station', slug: 'phan-thiet' },
      '?propertyId=p-vt&checkIn=2026-12-24&checkOut=2026-12-26&adults=3',
    );
    expect(target?.href).toBe(
      '/?ga=phan-thiet&checkIn=2026-12-24&checkOut=2026-12-26&adults=3#search-block',
    );
  });

  it('không có ngữ cảnh hợp lệ thì giữ nút mặc định', () => {
    expect(journeyTarget({ kind: 'cabin', code: 'DLX' }, '')).toBeNull();
    expect(journeyTarget({ kind: 'cabin', code: 'DLX' }, '?checkIn=2026-12-24')).toBeNull();
    expect(journeyTarget({ kind: 'station', slug: 'da-lat' }, '?adults=2')).toBeNull();
  });
});

describe('link chia sẻ báo giá', () => {
  it('mang tiêu chí và gói giá đang xem, không mang số tiền', () => {
    const url = shareUrl(
      { origin: 'https://pinehill.test', pathname: '/en/rooms/rt-1' },
      CRITERIA,
      'FLEX7',
    );
    expect(url).toBe(
      'https://pinehill.test/en/rooms/rt-1?propertyId=p-vt&checkIn=2026-12-24&checkOut=2026-12-27&adults=2&children=1&roomCount=1&ratePlanCode=FLEX7',
    );
    expect(shareUrl({ origin: 'https://x', pathname: '/rooms/a' }, CRITERIA, '')).not.toContain(
      'ratePlanCode',
    );
  });
});
