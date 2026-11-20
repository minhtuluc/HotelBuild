# Nền giao diện "vé tàu" cho hai app Android — kế hoạch thi công

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa hệ thiết kế "vé tàu" của web (token, font, vai nút, giấy vé, bảng ga) vào `@pinehill/ui-native` và áp cho hai app Android.

**Architecture:**
- Token và hàm style thuần nằm trong `packages/ui-native/src`. Component `.tsx` chỉ là lớp mỏng gọi các hàm style đó.
- Font đi qua lối riêng `@pinehill/ui-native/fonts`.
- `createTheme(surface)` thay hai file `theme.ts` đang giống hệt nhau và giữ nguyên tên khoá, nên mọi màn tự đổi giao diện.

**Tech Stack:** React Native 0.86, Expo SDK 57 (`expo-font`), `@expo-google-fonts/be-vietnam-pro` và `@expo-google-fonts/barlow-condensed` (OFL), vitest (node).

**Spec:** `docs/superpowers/specs/2026-11-20-android-theme-dong-bo-web-design.md`

## Global Constraints

- Màu phải bằng đúng giá trị của `@pinehill/ui-web/tokens` (`color`, `worldInk`).
- Mọi cặp chữ/nền dùng trong thành phần đạt WCAG AA ≥ 4,5:1.
- Cỡ chữ ≥ 12sp; tiền ≥ 14sp và có `tabular-nums`. Vùng chạm ≥ 48dp.
- Chỉ vật thể giấy mới có bóng; thẻ, nút và bảng không có bóng. Trạng thái không bấm được không dùng opacity.
- Trên giấy vé hồng, chữ phụ dùng `#6B2F22`, màu đỏ dùng `#962A16`.
- Không đổi câu chữ, luồng hay bố cục màn.
- Không export gì đụng tới `.ttf` từ `src/index.ts`.
- Lint của repo cấm `as` (trừ `as const`) và giới hạn độ phức tạp hàm.

---

### Task 1: Token "vé tàu" + font + test đồng bộ web (HB-272)

**Files:**
- Modify: `packages/ui-native/src/tokens.ts`
- Create: `packages/ui-native/src/fonts.ts` (lối `./fonts` trong `package.json`)
- Modify: `packages/ui-native/package.json` (exports, dependencies `expo-font`, hai gói font)
- Test: `packages/ui-native/test/tokens-ve-tau.spec.ts`

**Interfaces — Produces:** `worldInk`, `fontFamily`, `radius` mới, `typography.label`, `typography.board` (từ `@pinehill/ui-native`); `fontAssets`, `useBrandFonts()` (từ `@pinehill/ui-native/fonts`).

- [ ] **Step 1: Test đỏ**

```ts
import { describe, expect, it } from 'vitest';
import { color as webColor, worldInk as webInk, radius as webRadius } from '@pinehill/ui-web';
import { color, fontFamily, radius, typography, worldInk } from '../src/tokens.js';

describe('HB-272 token vé tàu', () => {
  it('màu trùng web', () => {
    expect(color).toEqual(webColor);
    expect(worldInk).toEqual(webInk);
  });
  it('bo góc như web', () => expect(radius).toEqual(webRadius));
  it('nhãn và bảng ga', () => {
    expect(typography.label.sp).toBe(12);
    expect(typography.board.fontVariant).toEqual(['tabular-nums']);
  });
  it('họ chữ theo độ đậm', () => {
    expect(fontFamily.sans).toBe('BeVietnamPro_400Regular');
    expect(fontFamily.displaySemiBold).toBe('BarlowCondensed_600SemiBold');
  });
});
```

- [ ] **Step 2:** Chạy `pnpm --filter @pinehill/ui-native exec vitest run test/tokens-ve-tau.spec.ts`. Kỳ vọng: FAIL, vì `worldInk` chưa có.
- [ ] **Step 3: Cài đặt**
  - Thêm vào `tokens.ts`:
    - `worldInk` sao y web;
    - `radius = { sm: 3, md: 6, lg: 10, full: 999 }`;
    - đổi `weight` của `display`, `h1`, `h2`, `money` thành `'600'`;
    - `label: { sp: 12, weight: '700', letterSpacing: 0.8 }`;
    - `board: { sp: 20, weight: '600', fontVariant: ['tabular-nums'] }`;
    - `fontFamily` (6 tên).
  - Tạo `fonts.ts`: nhập 6 module theo đường dẫn từng độ đậm (`@expo-google-fonts/be-vietnam-pro/400Regular` …). Export `fontAssets` và `useBrandFonts()`, hàm này trả `useFonts(fontAssets)` từ `expo-font`.
- [ ] **Step 4:** Chạy `vitest run` cả package (gồm cả test tương phản cũ) và `tsc`. Kỳ vọng: PASS.
- [ ] **Step 5:** Commit.

### Task 2: Hàm style và component dùng chung (HB-272)

**Files:**
- Create: `packages/ui-native/src/components/styles.ts` (hàm thuần)
- Create: `packages/ui-native/src/components/ticket-context.ts`
- Create: `packages/ui-native/src/components/primitives.tsx` (Button, Paper, Ticket, Board, BoardRow, Field, Money, StatusBadge, ScreenTitle, Step)
- Modify: `packages/ui-native/src/index.ts`
- Test: `packages/ui-native/test/components-style.spec.ts`

**Interfaces — Produces:**
- `buttonStyle({ role, size, disabled, pressed, onTicket })` trả `{ container: ViewStyle; label: TextStyle }`, với `role: 'accent' | 'primary' | 'outline' | 'danger'` và `size: 'md' | 'lg'`.
- `ticketStyle()`, `boardStyle()`, `boardRowStyle(selected)`, `fieldStyle({ focused, invalid })`, `labelStyle(onTicket)`, `moneyStyle(onTicket)`.

- [ ] **Step 1: Test đỏ.** Kiểm các điểm sau:
  - `accent` có nền `#B8341C`; trên giấy vé đổi sang `#962A16`.
  - `disabled` có nền `#E9E5DF`, chữ `#5A4640` và không có `opacity`.
  - `lg` cao 56, `md` cao 48.
  - `pressed` dịch y = 1.
  - Hàng bảng ga đang chọn có màu chữ `signalGo`.
  - Mọi cặp chữ/nền trả về đạt 4,5:1, kiểm bằng `contrastRatio`.
- [ ] **Step 2:** Chạy test. Kỳ vọng: FAIL.
- [ ] **Step 3:** Cài các hàm trong `styles.ts`; viết component mỏng trong `primitives.tsx` dùng `Pressable`/`Text`/`View`/`TextInput` với `accessibilityRole`/`accessibilityState`; `Ticket` bọc `TicketContext.Provider value={true}`.
- [ ] **Step 4:** Chạy test, `tsc` và `eslint packages/ui-native`. Kỳ vọng: PASS.
- [ ] **Step 5:** Commit.

### Task 3: `createTheme(surface)` (HB-272)

**Files:**
- Create: `packages/ui-native/src/theme.ts`
- Modify: `packages/ui-native/src/index.ts`
- Test: `packages/ui-native/test/theme.spec.ts`

**Interfaces — Produces:** `createTheme('guest' | 'ops')` trả `{ theme, stackScreenOptions, tabScreenOptions }`.
- `theme` có đủ các khoá cũ: `screen`, `scroll`, `scrollContent`, `card`, `cardMuted`, `hairline`, `divider`, `field`, `buttonPrimary`, `buttonPrimaryText`, `buttonSecondary`, `buttonSecondaryText`, `buttonDanger`, `buttonPlain`, `buttonPlainText`, `title`, `sectionTitle`, `body`, `muted`, `caption`, `tabular`, `money`, `moneyInline`, `alertDanger`, `alertWarning`, `alertSuccess`.
- Thêm các khoá mới: `ticket`, `label`, `board`.

- [ ] **Step 1: Test đỏ.**
  - Hai `surface` có cùng tập khoá, và tập khoá đó bao trọn danh sách cũ.
  - `guest`: `screen.backgroundColor` là `#DFE5F0`, `buttonPrimary.backgroundColor` là `#B8341C`, header nền `#121614` chữ `#F2B632`.
  - `ops`: nền `#F3F2EE`, `buttonPrimary` là `#1B3A82`, tiêu đề dùng `fontFamily.sansSemiBold`.
- [ ] **Step 2:** Chạy test. Kỳ vọng: FAIL.
- [ ] **Step 3:** Cài đặt.
  - Theo hai bảng màu ở spec §3.
  - Chữ dùng `fontFamily`, không đặt `fontWeight`.
  - `buttonDanger` là kiểu viền: nền `surface`, viền `danger`.
- [ ] **Step 4:** Chạy `vitest`, `tsc`, `eslint` và `pnpm check:scope`. Kỳ vọng: PASS. Commit, mở PR HB-272.

### Task 4: Áp theme `guest` cho app khách (HB-273, xếp chồng lên nhánh #353)

**Files:**
- Modify: `apps/customer-android/src/theme.ts` (chỉ còn `createTheme('guest')`)
- Modify: `apps/customer-android/app/_layout.tsx` (`useBrandFonts`, `useStatusBarStyle('light-content')`)
- Modify: `apps/customer-android/app/(tabs)/_layout.tsx` (`tabScreenOptions`)
- Modify: `packages/ui-native/src/status-bar.ts` (tổng quát `useStatusBarStyle`, giữ `useDarkStatusBar`)

- [ ] **Step 1:** Chạy test của app trước khi sửa để có mốc so sánh (`pnpm --filter @pinehill/customer-android exec vitest run`).
- [ ] **Step 2:** Sửa. `_layout` trả `null` khi font chưa nạp và chưa lỗi.
- [ ] **Step 3:** Chạy `tsc`, `eslint` và `vitest` của app. Kỳ vọng: số test pass bằng mốc.
- [ ] **Step 4:** Chạy trên máy thật. Chụp màn tìm phòng, kết quả, chi tiết phòng, xác nhận, thanh toán, đơn của tôi, chi tiết đơn, huỷ, đổi ngày, tài khoản. Kiểm dấu tiếng Việt, header bảng ga, nút đỏ dấu bấm. Commit, mở PR.

### Task 5: Áp theme `ops` cho app vận hành (HB-274, xếp chồng lên nhánh #353)

**Files:**
- Modify: `apps/operations-android/src/theme.ts` (`createTheme('ops')`)
- Modify: `apps/operations-android/app/_layout.tsx`

- [ ] **Step 1:** Chạy test của app trước khi sửa để có mốc.
- [ ] **Step 2:** Sửa giống Task 4, với `surface = 'ops'`.
- [ ] **Step 3:** Chạy `tsc`, `eslint` và `vitest`. Kỳ vọng: số test pass bằng mốc.
- [ ] **Step 4:** Chạy trên máy thật. Chụp màn chính, khách đến, tra cứu, đối soát, cảnh báo quá tải và đổi phòng. Commit, mở PR.
