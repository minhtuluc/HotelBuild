import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * HB-313 — 简体中文, 日本語, 한국어, Русский: URL có tiền tố, `html lang`, tiêu đề và trang ga theo ngôn ngữ,
 * link nội bộ giữ locale, font CJK theo `:lang()`, không cuộn ngang ở 360px, axe sạch.
 */
function customerWebOnly(): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('customer-web'),
      'ca này chỉ chạy trên customer-web',
    );
  });
}

customerWebOnly();

interface LocaleCase {
  readonly prefix: string;
  readonly lang: string;
  readonly title: string;
  readonly heading: string;
  readonly bookings: string;
  readonly station: string;
  /** Một font hệ thống đúng chữ, phải có trong `font-family` của body (null: không đổi body). */
  readonly bodyFont: string | null;
}

const CASES: readonly LocaleCase[] = [
  {
    prefix: '/zh-cn',
    lang: 'zh-CN',
    title: 'Pine Hill · 官网直订',
    heading: '一晚一段，',
    bookings: '我的预订',
    station: '大叻站',
    bodyFont: 'PingFang SC',
  },
  {
    prefix: '/ja',
    lang: 'ja',
    title: 'Pine Hill · 公式サイト予約',
    heading: '一泊ずつ、',
    bookings: 'マイ予約',
    station: 'ダラット駅',
    bodyFont: 'Hiragino Sans',
  },
  {
    prefix: '/ko',
    lang: 'ko',
    title: 'Pine Hill · 공식 사이트 예약',
    heading: '하룻밤씩,',
    bookings: '내 예약',
    station: '달랏역',
    bodyFont: 'Malgun Gothic',
  },
  {
    prefix: '/ru',
    lang: 'ru',
    title: 'Pine Hill · Прямое бронирование',
    heading: 'Ночь за ночью.',
    bookings: 'Мои брони',
    station: 'Станция Далат',
    bodyFont: null,
  },
];

async function axeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (item) => item.impact === 'serious' || item.impact === 'critical',
  );
  expect(serious.map((item) => `${item.id}: ${item.nodes.length}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

test.describe('Tiếng Trung, Nhật, Hàn, Nga (HB-313)', () => {
  for (const item of CASES) {
    test(`${item.prefix}: html lang, tiêu đề, link giữ tiền tố, font, axe sạch`, async ({ page }) => {
      await page.goto(item.prefix);
      await expect(page.locator('html')).toHaveAttribute('lang', item.lang);
      await expect(page).toHaveTitle(item.title);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(item.heading);
      await expect(page.getByRole('link', { name: item.bookings }).first()).toHaveAttribute(
        'href',
        `${item.prefix}/bookings`,
      );
      const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      expect(bodyFont).toContain('Be Vietnam Pro');
      if (item.bodyFont !== null) expect(bodyFont).toContain(item.bodyFont);
      await axeClean(page);
    });

    test(`${item.prefix}: trang ga đúng ngôn ngữ, 360px không cuộn ngang`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(`${item.prefix}/stays/da-lat`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(item.station);
      await expect(page.getByTestId('station-cta')).toHaveAttribute(
        'href',
        `${item.prefix}?ga=da-lat#search-block`,
      );
      expect(await noHorizontalScroll(page)).toBe(true);
      await page.goto(item.prefix);
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  }

  test('chọn ngôn ngữ đủ sáu mục, đổi sang tiếng Nhật giữ đường dẫn và tham số', async ({
    page,
  }) => {
    await page.goto('/stays/da-lat?from=test');
    const select = page.getByTestId('language-select');
    await expect(select.locator('option')).toHaveText([
      'Tiếng Việt',
      'English',
      '简体中文',
      '日本語',
      '한국어',
      'Русский',
    ]);
    // Chọn sau khi hydrate: trước đó <select> chưa có onChange dù chữ SSR đã hiện.
    await page.waitForLoadState('networkidle');
    await select.selectOption('ja');
    await expect(page).toHaveURL(/\/ja\/stays\/da-lat\?from=test$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ダラット駅');
  });

  test('tìm phòng bằng tiếng Nhật: dòng ngày theo thói quen Nhật, sang /ja/search', async ({
    page,
  }) => {
    await page.goto('/ja');
    await page.getByRole('textbox', { name: 'チェックイン', exact: true }).fill('2026-12-24');
    await page.getByRole('textbox', { name: 'チェックアウト', exact: true }).fill('2026-12-26');
    await expect(page.getByTestId('search-checkIn-line')).toHaveText('2026/12/24(木)');
    await page.getByRole('button', { name: '検索' }).click();
    await expect(page).toHaveURL(/\/ja\/search\?/);
    await expect(page.getByTestId('availability-table')).toBeVisible();
  });
});
