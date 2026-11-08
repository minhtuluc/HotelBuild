# HB-186 — kết quả rà i18n, lượt 2 ngày 08/11/2026

**Kết luận: CHƯA ĐẠT, nhưng đã giảm mạnh.** Audit mã tại `f88874bd787199944f65c00d27d71fabdde4ee04` (main sau #258), không phải nghiệm thu toàn bộ màn hình/go-live. Lượt 1 (14/10/2026, `7b1037c`) có **90 node literal giao diện ngoài catalog tại 26 tệp**; lượt này còn **6 node UI trong app + 8 node UI trong 2 formatter dùng chung** (xem §2). Toàn bộ 90 node của lượt 1 không còn xuất hiện trong kết quả quét. Một câu template có thể gồm nhiều node; không hiểu các con số là số câu độc lập. Lượt này chỉ rà và ghi bằng chứng, **không sửa mã sản phẩm** (ticket chỉ cho sửa tệp này).

Căn cứ: [HB-186](../08-thi-cong/tickets/HB-186-ra-soat-i18n.md), [NFR-LOC-01…03](../01-yeu-cau/yeu-cau-phi-chuc-nang.md#9-nfr-loc--nội-địa-hoá--quy-ước-việt-nam), [thiết kế màn hình §7.4/§8](../04-thiet-ke/thiet-ke-man-hinh.md). Số dòng luôn là dòng ở SHA đã rà.

## 1. Phạm vi và phương pháp

Cùng phương pháp lượt 1: danh sách tệp Git `apps/{customer-web,operations-web,customer-android,operations-android}/{src,app}/**`, chỉ JS/TS/JSX/TSX, bỏ test, TypeScript AST cho literal, mảnh template và JSX text có ký tự tiếng Việt, rồi phân loại tay theo ngữ cảnh (đọc mã quanh từng dòng và nơi `ApiError.message` được dùng). Lượt này **thêm** `packages/ui-web/src` và `packages/ui-native/src` (lượt 1 chưa phủ) bằng cùng kịch bản đổi biểu thức đường dẫn.

| App | Tệp nguồn | Ứng viên | UI thật | Nguy cơ gián tiếp | Không phải UI |
| --- | ---: | ---: | ---: | ---: | ---: |
| customer-web | 82 | 6 | 0 | 3 | 3 |
| operations-web | 396 | 14 | 5 | 1 | 8 |
| customer-android | 47 | 4 | 0 | 0 | 4 |
| operations-android | 106 | 7 | 1 | 0 | 6 |
| **Tổng apps** | **631** | **31** | **6** | **4** | **21** |
| `packages/ui-web`, `ui-native` | 16 | 73 | 8 | 0 | 65 (`stateMessages.ts` là catalog 58 node + 7 nhãn/lỗi/ký hiệu) |

Lượt 1: 331 tệp, 25 catalog, 105 ứng viên, 90 UI. Lượt này: 631 tệp, 44 catalog (nhận diện theo tên như lượt 1), 31 ứng viên. `packages/ui-native/src/stateMessages.ts` là catalog thật nhưng tên không khớp mẫu của kịch bản nên hiện trong kết quả quét gói; không tính là vi phạm.

## 2. Vi phạm còn lại (đã đối chiếu mã)

**A. Chuỗi UI ngoài catalog — 6 node trong app:**

| Tệp:dòng | Nội dung / hướng sửa |
| --- | --- |
| `apps/operations-web/src/features/hb132-scr40-cau-hinh-kenh/forms.tsx:108,207` | `cancelLabel="Huỷ"` của hai `ConfirmDialog`; lấy từ catalog như `confirmLabel` ngay bên cạnh. |
| `apps/operations-web/src/session/login-model.ts:76` | `formatWait` ghép "giây"/"phút" cứng, được `view-text.ts:26,30` đưa vào câu khoá/giới hạn tần suất; đưa đơn vị vào catalog (số nhiều/đơn vị theo `text()`). |
| `apps/operations-web/src/app/(ops)/front-desk/front-desk-api.ts:118` | `ApiError` giả "Cơ sở ngoài phạm vi" có `status 403`; được `front-desk-model.ts:95` gán vào `reason` và `desk-tables.tsx:53` hiển thị. Dùng mã lỗi + catalog thay vì message. |
| `apps/operations-android/src/lookup/view.ts:139` | `formatStay` ghép "đêm" cứng; dùng catalog hoặc formatter chung đã có cho ngày/kỳ ở. |

**B. Shared formatter (UI, 8 node):** `packages/ui-web/src/format.ts:49` (`formatStayPeriod`: "đêm · người lớn · trẻ em", dùng ở nhiều màn customer-web) và `:58` (`formatRemaining`: "còn … giờ … phút"). Đây là câu chữ hiển thị nằm ngoài catalog; chuyển sang catalog nhận tham số hoặc để caller truyền nhãn.

**C. Nguy cơ gián tiếp, chưa kết luận — 4 node:** `customer-web/(guest)/account/account-api.ts:36,50` và `account/api/handlers.ts:78` (customer-web không có chỗ render `ApiError.message` cho màn tài khoản), `operations-web/src/lib/ops-session.ts:58` (thân lỗi 401 do BFF dựng; `ApiError.message` được hiển thị ở `admin/users/users-model.ts:216` và `refunds/refund-command.ts:108`, chưa chứng minh có đường nào đưa thông điệp 401 này tới đó). Khuyến nghị: đưa vào catalog hoặc bỏ message, chỉ dùng `code`.

**D. Không phải UI (21 node app + 7 trong gói), giữ phân loại lượt 1:** 4 `src/config/index.ts` (8 node), 2 `api/ready/route.ts`, 2 `OfflineError` trong `netinfo.ts`, `customer-android/src/search.ts:135`, `operations-web/src/lib/seasons.ts:98`, `operations-web/src/app/(ops)/admin-commands/controller.ts:118`, `operations-web/src/session/staff-auth.ts:14` và `staff-session.tsx:32` (lỗi lập trình; `StaffLoginError` chỉ dùng `.failure`), `operations-web/src/lib/ops-session.ts:89`, `operations-android/src/{housekeeping/date.ts:10,lookup/view.ts:134,stay/model.ts:59}` (`RangeError` kiểm tiền/ngày), và trong gói: `ui-web/src/format.ts:31,41`, `ui-native/src/format.ts:27` (RangeError), nhãn `(giờ VN)` ở `ui-web/src/format.ts:44` / `ui-native/src/format.ts:30` (nhãn bắt buộc của NFR-LOC-03 nằm trong chính formatter dùng chung), và ký hiệu chữ "Đ" ở `tokens.ts:44,52` (glyph trạng thái "đang ở", không phải câu).

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

- **Audit nguồn: đã chạy** lại trên `f88874b`; **NFR-LOC: CHƯA ĐẠT** do §2 A–B (14 node) và C (chưa kết luận).
- **Formatter runtime Node: đã chạy**, cùng kết quả dưới 3 múi giờ; không nhận đã chạy formatter/UI trên Hermes hoặc thiết bị Android.
- **QA hình ảnh 6 màn, đủ 4 app: BLOCKED/chưa thực hiện**; Android không có thiết bị/emulator ở lượt này. Không suy từ source hoặc bundle sang bằng chứng hiển thị native.
- **Việc sửa (cần ticket riêng ngoài `allow` của HB-186):** thay các node ở §2 A–B bằng catalog. Ưu tiên `formatStayPeriod`/`formatRemaining` (ảnh hưởng nhiều màn), sau đó `Huỷ` và `formatWait`.
- Cổng `npm run check:docs` chạy trên commit giao; bằng chứng cuối cùng là CI GitHub của PR.

HB-186 giữ OPEN cho tới khi §2 sạch và kiểm hình ảnh/múi giờ xong. Không thay đổi ticket, BR, hợp đồng hoặc test khoá để đóng cổng.
