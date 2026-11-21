/** HB-277 — màn nội dung native dùng chung dữ liệu và câu chữ với web khách. */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
import { readWebOrigin } from '../src/config';
import { setLocale } from '../src/i18n/locale';
import { ct } from '../src/content/text';
import { photoUri, stationSlug } from '../src/content/photos';

afterEach(() => setLocale('vi'));

describe('HB-277 câu chữ nội dung theo ngôn ngữ (khoá của web)', () => {
  it('đổi theo ngôn ngữ đang chọn, có biến', () => {
    expect(ct('guest.nav.explore')).toBe('Khám phá');
    expect(ct('guest.station.title', { name: 'Đà Lạt' })).toBe('Ga Đà Lạt');
    setLocale('en');
    expect(ct('guest.nav.explore')).not.toBe('Khám phá');
  });
});

describe('HB-277 ảnh tải từ web', () => {
  it('chỉ nhận origin HTTP(S) đúng dạng; thiếu thì không hiện ảnh', () => {
    expect(readWebOrigin({ EXPO_PUBLIC_WEB_ORIGIN: 'https://pinehill.vn' })).toBe(
      'https://pinehill.vn',
    );
    expect(readWebOrigin({ EXPO_PUBLIC_WEB_ORIGIN: 'https://pinehill.vn/' })).toBe(
      'https://pinehill.vn',
    );
    expect(readWebOrigin({ EXPO_PUBLIC_WEB_ORIGIN: 'ftp://x' })).toBeNull();
    expect(readWebOrigin({})).toBeNull();
  });

  it('dùng bản 640w của ô ảnh; mã ô lạ thì không dựng đường dẫn', () => {
    expect(photoUri('ga-DL-poster', 'https://pinehill.vn')).toBe(
      'https://pinehill.vn/images/pine-hill/ga-DL-poster-640w.webp',
    );
    expect(photoUri('../x', 'https://pinehill.vn')).toBeNull();
    expect(photoUri('ga-DL-poster', null)).toBeNull();
  });

  it('mã ga khớp trang ga', () => {
    expect(stationSlug('DL')).toBe('da-lat');
    expect(stationSlug('XX')).toBeNull();
  });
});
