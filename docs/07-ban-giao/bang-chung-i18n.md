# HB-186 — kết quả rà i18n ngày 14/10/2026

**Kết luận: CHƯA ĐẠT.** Audit mã hiện có tại `7b1037ce76cae3c0fbbbe70b0295a642b67dd92a`, không phải nghiệm thu toàn bộ màn hình/go-live. Có **90 node literal giao diện ngoài catalog, tại 26 tệp**. Một câu template có thể gồm nhiều node; không hiểu con số này là 90 câu độc lập. Chưa sửa mã sản phẩm trong lượt audit này.

Căn cứ: [HB-186](../08-thi-cong/tickets/HB-186-ra-soat-i18n.md), [NFR-LOC-01…03](../01-yeu-cau/yeu-cau-phi-chuc-nang.md#9-nfr-loc--nội-địa-hoá--quy-ước-việt-nam), [thiết kế màn hình §7.4/§8](../04-thiet-ke/thiet-ke-man-hinh.md). Các dòng dưới đây luôn là dòng ở SHA đã rà, không phải số dòng sau các bản sửa tương lai.

## 1. Phạm vi và phương pháp

Kiểm danh sách tệp Git theo `apps/{customer-web,operations-web,customer-android,operations-android}/{src,app}/**`, chỉ JS/TS/JSX/TSX; không quét node_modules, dist, test hoặc nhận xét làm text giao diện. Dùng TypeScript AST 5.9.3 cho literal, các mảnh template và JSX text có ký tự tiếng Việt; kiểm tay kết quả trong ngữ cảnh hiển thị. Bản kiểm soát của scanner xác nhận nhận xét không thành finding, còn string/template/JSX được phát hiện.

| App | Tệp nguồn | Catalog được xác minh | Node cần rà tay | Node UI xác nhận / số tệp |
| --- | ---: | ---: | ---: | ---: |
| customer-web | 59 | 2 | 25 | 22 / 4 |
| operations-web | 201 | 16 | 30 | 25 / 13 |
| customer-android | 39 | 3 | 44 | 40 / 7 |
| operations-android | 32 | 4 | 6 | 3 / 2 |
| **Tổng** | **331** | **25** | **105** | **90 / 26** |

Catalog gồm `lib/i18n.ts`, `strings.ts`, `messages*.ts`, `write-messages.ts` và hai `src/demo.ts` Android có khai báo catalog qua `makeTranslate`. Hai demo là danh mục thật đang được layout/not-found dùng; không gắn nhãn vi phạm chỉ vì tên tệp là demo. Các tệp hỗn hợp này đã được đọc để xác minh phần text tiếng Việt được quét nằm trong catalog.

**15 node không tính vào 90 UI:** 8 node trong 4 `src/config/index.ts`; 2 node ở 2 web `src/app/api/ready/route.ts:16`; 2 thông báo `OfflineError` trong Android `src/netinfo.ts`; `customer-android/src/search.ts:135` và `operations-web/src/lib/seasons.ts:98` là lỗi lập trình/kiểm tra; `operations-web/src/app/(ops)/admin-commands/controller.ts:117` là ApiError.message không được ScreenAlert render. Không dùng các trường hợp này làm bằng chứng lỗi text hiển thị. Đây không phải xác nhận mọi nơi xử lý lỗi tương lai đều an toàn.

## 2. Vi phạm chuỗi ngoài catalog — đã đối chiếu mã

Đường dẫn trong bảng tính từ gốc repo. Dòng được gộp theo tệp, gồm cả nhãn trợ năng, metadata và nội dung CSV mà người dùng nhận; không chỉ nhìn text trong JSX.

| Tệp:dòng | Nội dung / hướng sửa |
| --- | --- |
| `apps/customer-android/src/payment/panels.tsx:46,49,51,53,56,59,63,70,73,79,97,148,158,162,174,180,190,196,197,201` | Nhãn số dư/giao dịch, xác nhận, liên kết và nhãn trợ năng; chuyển vào catalog payment, giữ nguyên quyết định/số tiền từ server. |
| `apps/customer-android/src/payment/screen.tsx:34,44,49,64,68,69` | Tiêu đề, loading, dữ liệu đổi, lỗi mở trình duyệt và quay về đơn; dùng catalog. |
| `apps/customer-android/app/payment/[bookingId].tsx:8` | Stack title “Thanh toán tiền cọc”; dùng catalog như nội dung màn. |
| `apps/customer-android/app/booking/[code].tsx:200,203` | Text và accessibilityLabel liên kết thanh toán. |
| `apps/customer-android/app/booking/confirm.tsx:360` | Hậu tố “phòng” nối cứng vào kỳ ở. |
| `apps/customer-android/src/orders.ts:163` | Template “đêm · phòng” trong stayOf; caller không thể dịch các mảnh này. |
| `apps/customer-android/app/index.tsx:86` | ActivityIndicator accessibilityLabel “Đang khôi phục phiên”. |
| `apps/customer-web/src/app/(guest)/booking/[bookingId]/pay/payment-panels.tsx:38,39,45,68,70,72,74,78,84,91,115,141,181,183,186,191` | Câu chữ so sánh, validation, số dư, cổng và kết quả giao dịch còn viết cứng dù đã có messages-payment.ts. |
| `apps/customer-web/src/app/(guest)/bookings/[bookingId]/reschedule/reschedule-parts.tsx:41` | Hậu tố “đêm” viết cứng trong kỳ mới. |
| `apps/customer-web/src/app/(guest)/states/states-client.tsx:15,17` | “Số người lớn”, “Tiếp tục” ở màn trạng thái F0. |
| `apps/customer-web/src/app/layout.tsx:8` | Metadata description tiếng Việt ngoài catalog. |
| `apps/operations-android/app/index.tsx:58` | ActivityIndicator accessibilityLabel khôi phục phiên. |
| `apps/operations-android/app/pin-setup.tsx:52,67` | “PIN lần 1/2” trong accessibilityLabel. |
| `apps/operations-web/src/app/(ops)/admin-commands/controller.ts:321` | Fallback field “(biểu mẫu)” được chuyển tới StateSurface. |
| `apps/operations-web/src/app/(ops)/admin-commands/panels.tsx:15` | Giá trị version mặc định “mới” đi vào câu xung đột. |
| `apps/operations-web/src/app/(ops)/bookings/[bookingId]/refunds/refund-actions.ts:90` | Field lỗi “Chi hoàn”; dịch field trước khi dựng state, giữ issue hiện có. |
| `apps/operations-web/src/app/(ops)/bookings/bookings-model.ts:145` | Template stayOf có “đêm · phòng” ngoài catalog. |
| `apps/operations-web/src/app/(ops)/channel-allotments/use-allotments.ts:36` | Field validation “(biểu mẫu)”. |
| `apps/operations-web/src/app/(ops)/properties/properties-screen.tsx:344` | Fallback version “mới” trong câu so sánh. |
| `apps/operations-web/src/app/(ops)/rooms/rooms-screen.tsx:171` | Fallback version “mới” trong câu so sánh. |
| `apps/operations-web/src/app/(ops)/states/states-client.tsx:15,17` | “Ghi chú xử lý”, “Lưu” ở màn trạng thái F0. |
| `apps/operations-web/src/app/(ops)/system-settings/controller.ts:338` | Field validation “(biểu mẫu)”. |
| `apps/operations-web/src/app/layout.tsx:8` | Metadata description ngoài catalog. |
| `apps/operations-web/src/lib/audit-log.ts:76,77,78,79,80,81` | Sáu tiêu đề CSV tiếng Việt ngoài catalog; chuyển nguồn text, không đổi cột/escaping/chống formula injection. |
| `apps/operations-web/src/lib/rate-plans.ts:124,184` | Hai field validation “(biểu mẫu)”. |
| `apps/operations-web/src/lib/screen-state.ts:8,11,32,40,60` | “chưa rõ”, “(biểu mẫu)”, “không có mã”, “không hợp lệ” được StateSurface hiện. |

Ưu tiên sửa luồng thanh toán web/Android và nhãn trợ năng đăng nhập/PIN trước; tiếp theo các fallback validation/CSV và các màn minh hoạ. Đây là thay nguồn câu chữ; không đưa luật tiền, trạng thái hay phân quyền vào catalog/frontend.

## 3. Tiền, số và ngày giờ

| Kiểm tra | Kết quả / vị trí |
| --- | --- |
| Format tiền VND thật | `packages/ui-web/src/format.ts:30` và `apps/customer-android/src/search.ts:134` trả `1.100.000 ₫` và phần số `1.100.000`; từ chối 1.5, NaN, Infinity. Kiểm cả 0, 999 và số âm. Không nhận đây là proof mọi input mọi màn đã được kiểm. |
| Ký hiệu tiền Android payment | `apps/customer-android/src/payment/panels.tsx:49,51,53,56` nối ` đ`, khác mẫu ký hiệu đồng ` ₫` của NFR-LOC-03 và các màn khác. Đưa suffix vào template tiền của catalog. |
| Số thập phân theo locale | `apps/customer-web/src/app/(guest)/bookings/cancel-model.ts:70` dùng `toFixed(1)` và được cancel-screen.tsx:71 hiển thị: đầu vào 1.5 cho `1.5`, trong khi vi-VN là `1,5`. Đây là **số giờ**, không kết luận là phép tính tiền bằng float. |
| Ngày chỉ có ngày lịch | `apps/customer-android/src/orders.ts:163`, `app/booking/confirm.tsx:360`, `apps/operations-web/src/app/(ops)/bookings/bookings-model.ts:145`, `apps/customer-web/src/app/(guest)/bookings/[bookingId]/reschedule/reschedule-parts.tsx:41`, `apps/operations-android/src/housekeeping/task-card.tsx:22` hiện ngày ISO nguyên văn. Cần formatter ngày lịch dd/MM/yyyy; không đổi ngày business sang một instant hoặc tự cộng giờ. |
| Formatter thời điểm dùng chung | `packages/ui-web/src/format.ts:39`, `packages/ui-native/src/format.ts:25`: các mốc 00:00/23:59 VN, tháng 3 và tháng 11 có đúng nhãn `(giờ VN)`, không phụ thuộc TZ máy. Chạy cùng input dưới UTC, America/New_York và Asia/Tokyo đều đạt. |
| Locale nội bộ | Intl `en-CA` ở inventory-grid/search-model/housekeeping reader tạo business-date cho request; không kết luận đây là text tiếng Anh trên UI. |

Rà tìm decimal literal/parseFloat/toFixed/toLocale trong corpus: các số 0.1 của multiplier và 0.5 của opacity không phải tiền; không gắn nhãn vi phạm tiền. **Chưa chứng minh toàn ứng dụng có 0 tiền dạng số thực hoặc 100% mọi mốc đã mang nhãn giờ VN** chỉ từ grep/formatter controls. Các trường ngày-only và các luồng chưa triển khai cần kiểm riêng. Shared UI còn text formatter như `formatStayPeriod`/`formatRemaining`; danh sách 90 ở trên chỉ đếm app, không nhận đã audit mọi chuỗi trong packages.

## 4. Chạy lại kiểm kê AST

Từ gốc repo đã cài frozen lockfile, dùng lệnh dưới trên đúng SHA cần kiểm. Lệnh chỉ đọc; kết quả là **ứng viên**, phải phân loại trong ngữ cảnh như §1–2. Không bỏ qua cả thư mục app hoặc nới kiểm để đạt 0.

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

Corpus SHA nói trên cho 331 tệp/25 catalog/105 ứng viên; sau rà tay còn 90 node UI. Scanner không phát hiện mọi chuỗi không dấu/tiếng Anh, text sinh động từ API hay font/render sai dấu. Không dùng con số 0 của một regex để thay nghiệm thu màn hình.

## 5. Cổng và phần còn mở

- **Audit nguồn: đã chạy**, có bảng vi phạm cụ thể; **NFR-LOC: CHƯA ĐẠT** theo §2–3.
- **Formatter runtime Node: đã chạy**, cùng kết quả dưới 3 TZ; không nhận đã chạy formatter/UI trên Hermes hoặc thiết bị Android.
- **QA hình ảnh 6 màn, đủ 4 app: BLOCKED/chưa thực hiện trong lượt audit này**; Android không có thiết bị/emulator. Không suy từ source hoặc bundle sang bằng chứng hiển thị native. Các phần F8/F7 còn chưa hoàn thành nên không thể ký nghiệm thu toàn bộ frontend.
- Cổng docs/CI trên commit giao phải xem hồ sơ bàn giao đúng SHA; tài liệu này không tự thay log kiểm chứng. GitHub Actions cấp repo đang tắt; hosted gate vẫn BLOCKED.

HB-186 giữ OPEN để sửa các finding, chạy lại scan và kiểm hình ảnh/múi giờ trên toàn bộ các màn đã triển khai. Không thay đổi ticket, BR, hợp đồng hoặc test khoá để đóng cổng.
