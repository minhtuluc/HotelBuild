import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * HB-316 — góp ý UI/UX gói B: bảng giá từng đêm trên điện thoại, lightbox chạm/bấm nền, chuyển động
 * "an toàn SSR" và công tắc giảm chuyển động.
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

const STAY = 'checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0';

async function noHorizontalScroll(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function axeClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (item) => item.impact === 'serious' || item.impact === 'critical',
  );
  expect(serious.map((item) => `${item.id}: ${item.nodes.length}`)).toEqual([]);
}

test.describe('Bảng giá trên điện thoại (UX-01)', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('vé mẫu trang chủ hiện lý do giá của cả 3 đêm, không cuộn ngang', async ({ page }) => {
    await page.goto('/');
    const reasons = page.locator('.ph-sample-why');
    await expect(reasons).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      const reason = reasons.nth(index);
      await reason.scrollIntoViewIfNeeded();
      await expect(reason).toBeVisible();
      await expect(reason).not.toHaveText('');
    }
    await noHorizontalScroll(page);
  });

  test('bảng giá từng đêm SCR-03 thành thẻ có nhãn cột, không cuộn ngang, axe sạch', async ({
    page,
  }) => {
    await page.goto(`/rooms/synthetic-room?propertyId=synthetic-property&${STAY}`);
    const table = page.getByTestId('nights-table');
    await expect(table).toBeVisible();
    const firstCell = table.locator('tbody tr').first().locator('td').nth(1);
    const label = await firstCell.evaluate(
      (node) => getComputedStyle(node, '::before').content,
    );
    expect(label).not.toBe('none');
    await expect(table.locator('thead')).toHaveCSS('position', 'absolute');
    await noHorizontalScroll(page);
    await axeClean(page);
  });
});

test.describe('Lightbox chạm (UX-08)', () => {
  test('bấm ra nền thì đóng; vuốt trái sang ảnh sau', async ({ page }) => {
    await page.goto('/stays/da-lat');
    await page.getByRole('button', { name: /^Xem ảnh 1\/4:/ }).click();
    const figure = page.getByTestId('gallery-figure');
    await expect(page.getByTestId('gallery-position')).toHaveText('Ảnh 1/4');
    const box = await figure.boundingBox();
    if (box === null) throw new Error('khung ảnh không có kích thước');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('gallery-position')).toHaveText('Ảnh 2/4');
    // Góc trên trái của <dialog> là nền đệm, ngoài khung ảnh và nút đóng.
    const dialog = await page.getByTestId('gallery-lightbox').boundingBox();
    if (dialog === null) throw new Error('lightbox không có kích thước');
    await page.mouse.click(dialog.x + 4, dialog.y + 4);
    await expect(page.getByTestId('gallery-lightbox')).toHaveCount(0);
  });
});

test.describe('Chuyển động an toàn (ANIM-04, ANIM-06)', () => {
  test('HTML máy chủ không ẩn dải nào; dải dưới màn đầu trượt lên khi cuộn tới', async ({
    page,
    request,
  }) => {
    const html = await (await request.get('/')).text();
    expect(html).not.toContain('ph-reveal-pending');
    expect(html).toContain('data-reveal');
    await page.goto('/');
    await expect.poll(() => page.locator('.ph-reveal-pending').count()).toBeGreaterThan(0);
    // Dải đã nằm trong màn đầu lúc tải không bao giờ bị gắn trạng thái chờ.
    const pendingInFold = await page.evaluate(() =>
      [...document.querySelectorAll('.ph-reveal-pending')].some(
        (node) => node.getBoundingClientRect().top < window.innerHeight,
      ),
    );
    expect(pendingInFold).toBe(false);
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    });
    await expect(page.locator('.ph-reveal-pending')).toHaveCount(0);
  });

  test('giảm chuyển động: không gắn trạng thái chờ, tem hạng không chạy hoạt ảnh', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.ph-reveal-pending')).toHaveCount(0);
    await page.goto('/room-types/DLX');
    await expect(page.locator('.ph-cabin-stamp')).toHaveCSS('animation-name', 'none');
  });
});
