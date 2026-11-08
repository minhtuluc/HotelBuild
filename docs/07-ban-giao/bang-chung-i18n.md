# HB-186 — kết quả rà i18n, lượt 3 ngày 09/11/2026

**Kết luận: audit nguồn ĐẠT — 0 node chuỗi giao diện ngoài catalog; NFR-LOC chưa nghiệm thu đủ vì QA hình ảnh Android vẫn BLOCKED.** Audit mã tại `059cdd8e2ff24d0faac786d6cdfcaf681dffb618` (main sau #260, #262, #264, #265), không phải nghiệm thu toàn bộ màn hình/go-live. Lượt 1 (14/10/2026, `7b1037c`) có **90 node UI ngoài catalog tại 26 tệp**; lượt 2 (08/11/2026, `f88874b`) còn **6 node UI trong app + 8 node trong formatter dùng chung + 4 node gián tiếp chưa kết luận**. Lượt này: 14 node A–B đã được HB-218 (#262) đưa vào catalog và không còn trong kết quả quét; 4 node gián tiếp (C) đã truy tới nơi dùng và **không có đường hiển thị** (xem §2), nên chuyển sang nhóm không phải UI. Một câu template có thể gồm nhiều node; không hiểu các con số là số câu độc lập.

Căn cứ: [HB-186](../08-thi-cong/tickets/HB-186-ra-soat-i18n.md), [NFR-LOC-01…03](../01-yeu-cau/yeu-cau-phi-chuc-nang.md#9-nfr-loc--nội-địa-hoá--quy-ước-việt-nam), [thiết kế màn hình §7.4/§8](../04-thiet-ke/thiet-ke-man-hinh.md). Số dòng luôn là dòng ở SHA đã rà.

## 1. Phạm vi và phương pháp

Cùng phương pháp lượt 1–2 và cùng kịch bản §4 (không đổi biểu thức, không bỏ thư mục): danh sách tệp Git `apps/{customer-web,operations-web,customer-android,operations-android}/{src,app}/**`, chỉ JS/TS/JSX/TSX, bỏ test, TypeScript AST cho literal, mảnh template và JSX text có ký tự tiếng Việt; chạy lần hai cho `packages/ui-web/src` và `packages/ui-native/src` bằng cách đổi biểu thức đường dẫn như §4 hướng dẫn. Sau đó phân loại tay theo ngữ cảnh (đọc mã quanh từng dòng và nơi `ApiError.message` được dùng).

| App | Tệp nguồn | Ứng viên | UI thật | Nguy cơ gián tiếp | Không phải UI |
| --- | ---: | ---: | ---: | ---: | ---: |
| customer-web | 82 | 6 | 0 | 0 | 6 |
| operations-web | 396 | 9 | 0 | 0 | 9 |
| customer-android | 47 | 4 | 0 | 0 | 4 |
| operations-android | 106 | 6 | 0 | 0 | 6 |
| **Tổng apps** | **631** | **25** | **0** | **0** | **25** |
| `packages/ui-web`, `ui-native` | 16 | 68 | 0 | 0 | 68 (`stateMessages.ts` là catalog 61 node + 7 nhãn/lỗi/ký hiệu) |

Lượt 2 → lượt 3: ứng viên app 31 → 25 (bớt đúng 6 node A), gói 73 → 68 (bớt 8 node B; catalog `stateMessages.ts` tăng 58 → 61 do HB-218 thêm 3 khoá `format.*`). Số tệp và catalog không đổi (631 tệp, 44 catalog). `packages/ui-native/src/stateMessages.ts` là catalog thật nhưng tên không khớp mẫu của kịch bản nên hiện trong kết quả quét gói; không tính là vi phạm.

## 2. Phân loại kết quả quét (đã đối chiếu mã)

**A. Chuỗi UI ngoài catalog trong app — 0 node.** Các vị trí lượt 2 (`hb132-scr40-cau-hinh-kenh/forms.tsx` `Huỷ`, `login-model.ts` `formatWait`, `front-desk-api.ts` "Cơ sở ngoài phạm vi", `operations-android/src/lookup/view.ts` "đêm") không còn trong kết quả; HB-218 có guard nguồn `apps/operations-web/test/hb218-i18n-source.spec.ts`, `apps/operations-android/test/lookup-i18n-source.spec.ts`.

**B. Formatter dùng chung — 0 node.** `formatStayPeriod`/`formatRemaining` của `packages/ui-web/src/format.ts` lấy chữ từ catalog (guard `packages/ui-web/test/format-i18n-source.spec.ts`; ui-native kiểm chéo `stateMessages` = catalog).

**C. Nguy cơ gián tiếp lượt 2 — đã kết luận, không phải UI (4 node):**

| Tệp:dòng | Vì sao không hiển thị |
| --- | --- |
| `apps/customer-web/src/app/(guest)/account/account-api.ts:36,50` | `message` của `ApiError` do client tài khoản dựng; không tệp nào trong `app/(guest)/account/**` đọc `.message` — UI chọn câu theo `kind`/`code` từ catalog. |
| `apps/customer-web/src/app/(guest)/account/api/handlers.ts:78` | Trường `message` bắt buộc của bao lỗi §4.1 mà BFF trả; client ở `account-api.ts:43–51` chỉ lấy `code`/`retryAfterSeconds` và thay `message` bằng chuỗi riêng (dòng 50, đã xét ở trên). |
| `apps/operations-web/src/lib/ops-session.ts:58` | Thân 401 khi thiếu bearer. Hai nơi hiện nguyên `ApiError.message` đều không nhận 401: `admin/users/users-model.ts:229` trả `expired` trước `rejected()`, `refunds/refund-command.ts` `transferFailure` chỉ nhận 400/409/422. |

**D. Không phải UI (25 node app + 7 trong gói), giữ phân loại lượt 1–2:** 4 `src/config/index.ts` (8 node), 2 `api/ready/route.ts`, 2 `OfflineError` trong `netinfo.ts`, `customer-android/src/search.ts:135`, `operations-web/src/lib/seasons.ts:98`, `operations-web/src/app/(ops)/admin-commands/controller.ts:118`, `operations-web/src/session/staff-auth.ts:14` và `staff-session.tsx:32` (lỗi lập trình; `StaffLoginError` chỉ dùng `.failure`), `operations-web/src/lib/ops-session.ts:89`, `operations-android/src/{housekeeping/date.ts:10,lookup/view.ts:134,stay/model.ts:59}` (`RangeError` kiểm tiền/ngày), 4 node nhóm C ở trên; trong gói: `ui-web/src/format.ts:34,44`, `ui-native/src/format.ts:27` (RangeError), nhãn `(giờ VN)` ở `ui-web/src/format.ts:47` / `ui-native/src/format.ts:30` (nhãn bắt buộc của NFR-LOC-03 nằm trong chính formatter dùng chung), và ký hiệu chữ "Đ" ở `tokens.ts:44` (ui-native) / `tokens.ts:52` (ui-web) (glyph trạng thái "đang ở", không phải câu).

## 3. Tiền, số và ngày giờ

| Kiểm tra | Kết quả / vị trí |
| --- | --- |
| Format tiền VND | `packages/ui-web/src/format.ts:30`: `0 ₫`, `999 ₫`, `1.100.000 ₫`; từ chối 1.5, NaN, Infinity (3/3 bị ném lỗi). Cùng định dạng ở `operations-android/src/lookup/view.ts:134` và `customer-android/src/search.ts:134`. |
| Ký hiệu tiền Android payment | **Đã sửa** so với lượt 1: không còn hậu tố ` đ` trong `customer-android/src` / `app`. |
| Số thập phân theo locale | **Đã sửa**: `cancel-model.ts` dùng `Intl.NumberFormat('vi-VN', {min/maxFractionDigits: 1})` cho số giờ. Trong `apps/**` và `packages/ui-*` không còn `toFixed`, `parseFloat`, `toLocale*`; các `toFixed(2)` còn lại nằm ở `apps/api`/`apps/worker` (giá trị `numeric` của SQL, không hiển thị). |
| Ngày chỉ có ngày lịch | **Đã sửa**: `stayOf` (`customer-android/src/orders.ts`, `operations-web/.../bookings-model.ts`) và `task-card.tsx` dùng `formatBusinessDate` → `dd/MM/yyyy` (mẫu `24/12/2026 → 26/12/2026 · 2 đêm · 1 phòng`). |
| Mốc thời điểm | `formatDateTimeVn` ở `ui-web` và `ui-native` chạy với `2026-03-29T16:59Z`, `2026-06-30T17:00Z`, `2026-11-07T16:59:59Z`, `2026-12-31T23:59+07:00`: ra `29/03/2026 23:59`, `01/07/2026 00:00`, `07/11/2026 23:59`, `31/12/2026 23:59`, đều kèm `(giờ VN)`, **hai gói cho kết quả trùng nhau**. Chạy dưới `TZ=UTC`, `America/New_York`, `Asia/Tokyo`: đầu ra giống hệt (cùng hash). 102 dòng tham chiếu `formatDateTimeVn` (gồm import) ở 44 tệp trong `apps/**`. |
| Locale nội bộ | `Intl` `en-CA` ở inventory-grid/search-model/housekeeping reader tạo business-date cho request; không phải text tiếng Anh trên UI. |

**Chưa chứng minh** toàn ứng dụng có 0 tiền dạng số thực hoặc 100% mọi mốc đã mang nhãn giờ VN: kết quả trên là quét tĩnh + chạy formatter, không phải kiểm từng màn. Chưa quét được chuỗi không dấu, chuỗi tiếng Anh, text sinh động từ API, thông điệp lỗi do máy chủ trả.

## 4. Chạy lại kiểm kê AST

Từ gốc repo đã cài frozen lockfile, chạy trên đúng SHA cần kiểm. Lệnh chỉ đọc; kết quả là **ứng viên**, phải phân loại trong ngữ cảnh như §1–2. Không bỏ qua cả thư mục app hoặc nới kiểm để đạt 0. Để quét thêm gói dùng chung, thay biểu thức đường dẫn `^apps\/(customer|operations)-(web|android)\/(src|app)\/` bằng `^packages\/(ui-web|ui-native)\/src\/`.

```sh
node --input-type=module <<'JS'
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const ts=createRequire(path.join(process.cwd(),'package.json'))('typescript');
const files=execFileSync('git',['ls-files','-z']).toString().split('\0').filter(f=>
  /^apps\/(customer|operations)-(web|android)\/(src|app)\//.test(f) && /\.[cm]?[jt]sx?$/.test(f));
const isCatalog=f=>/\/(i18n|strings|(write-)?messages(-[\w-]+)?)\.ts$/.test(f) ||
  /^apps\/(customer|operations)-android\/src\/demo\.ts$/.test(f);
const hits=[];
for(const file of files.filter(f=>!isCatalog(f))){
  const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,
    file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  if(ast.parseDiagnostics.length) throw Error('Source parse failure');
  const walk=n=>{
    if((ts.isStringLiteralLike(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||
      ts.isTemplateTail(n)||ts.isJsxText(n)) && /[À-ÖØ-öø-ỹĐđ]/u.test(n.text)){
      const text=n.text.replace(/\s+/g,' ').trim();
      if(text) hits.push({file,line:ast.getLineAndCharacterOfPosition(n.getStart(ast)).line+1,text});
    }
    ts.forEachChild(n,walk);
  };
  walk(ast);
}
console.log(JSON.stringify({files:files.length,catalogs:files.filter(isCatalog).length,hits},null,2));
JS
```

Kịch bản không phát hiện mọi chuỗi không dấu/tiếng Anh, text sinh động từ API hay font/render sai dấu. Không dùng con số 0 của một regex để thay nghiệm thu màn hình.

## 5. Cổng và phần còn mở

- **Audit nguồn: ĐẠT** trên `059cdd8` — 0 node UI ngoài catalog (A = B = C = 0).
- **Formatter runtime Node: đã chạy** lượt này: `pnpm --filter @pinehill/ui-web exec vitest run` 49/49 và `@pinehill/ui-native` 13/13, mỗi gói chạy dưới `TZ=UTC`, `America/New_York`, `Asia/Tokyo` (cùng kết quả). Số liệu §3 lấy từ lượt 2 trên `f88874b`; các hàm `formatMoney`/`formatDateTimeVn`/`formatBusinessDate` không đổi giữa hai SHA. Không nhận đã chạy formatter/UI trên Hermes hoặc thiết bị Android.
- **QA hình ảnh 6 màn, đủ 4 app: BLOCKED** — host không có thiết bị/emulator Android (không `adb`), WebKit không chạy trên host Fedora (TD-53). Không suy từ source hoặc bundle sang bằng chứng hiển thị native.
- Cổng `npm run check:docs` chạy trên commit giao; bằng chứng cuối cùng là CI GitHub của PR.

HB-186 giữ OPEN chỉ vì QA hình ảnh/thiết bị; phần audit nguồn đã sạch. Không thay đổi ticket, BR, hợp đồng hoặc test khoá để đóng cổng.
