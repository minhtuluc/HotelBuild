# Kế hoạch bổ sung lớp nội dung tĩnh cho Customer Web

**Trạng thái:** Đề xuất để lead review, chưa triển khai · **Phạm vi:** `apps/customer-web` · **Ngày:** 13/11/2026 · **Liên quan:** [Thiết kế màn hình](thiet-ke-man-hinh.md), [Ảnh trang khách](anh-trang-khach.md), [Yêu cầu API](../../YEU-CAU-API-TU-FRONTEND.md)

## 1. Bối cảnh

Customer web hiện có **13 màn hình nghiệp vụ** (`SCR-01` … `SCR-13`), triển khai thành 17 route page. Đây là một luồng đặt phòng tương đối đầy đủ: tìm phòng, báo giá từng đêm, chọn gói, tạo booking, thanh toán, tra cứu, huỷ, đổi ngày và hồ sơ khách.

Tuy nhiên, website thiếu lớp nội dung dẫn khách vào phễu đặt phòng:

- Không có trang tổng quan độc lập cho từng cơ sở.
- `SCR-03` (`/rooms/[roomTypeId]`) là màn **chi tiết báo giá**, không phải trang giới thiệu hạng phòng.
- Không có thư viện ảnh, ẩm thực, trải nghiệm, wellness, ưu đãi, di chuyển hay câu hỏi thường gặp.
- Header hiện chỉ có các mục phục vụ giao dịch, không có nhóm nội dung khám phá.
- Dữ liệu công khai từ API chưa có mô tả, tiện nghi, diện tích hay bộ ảnh của phòng.

Website tham chiếu Amanoi dùng Drupal 11 để render khoảng 50 trang nội dung tiếng Việt và chuyển giao dịch sang engine RevRaise. Pine Hill không cần CMS ở giai đoạn này: có thể dựng cùng lớp nội dung bằng dữ liệu tĩnh có kiểu trong frontend, miễn là tách khỏi luồng giá/tồn phòng thật.

## 2. Mục tiêu

1. Bổ sung một lớp website thông tin giúp khách hiểu cơ sở, phòng và trải nghiệm trước khi tìm phòng.
2. Không thay đổi 13 màn hình nghiệp vụ hiện có và không tự tính giá ở lớp nội dung.
3. Tách nội dung khỏi component để có thể thay bằng API/CMS và dịch đa ngôn ngữ sau này.
4. Không trình bày nội dung minh hoạ như dữ liệu thật của Pine Hill.

## 3. Kiến trúc thông tin đề xuất

| Route đề xuất | Mục đích | Nội dung chính | Tái sử dụng |
|---|---|---|---|
| `/stays/[propertySlug]` | Trang tổng quan cơ sở | Hero, câu chuyện, vị trí, tiện ích, phòng nổi bật, ẩm thực, trải nghiệm, gallery, CTA tìm phòng | 3 cơ sở: Đà Lạt, Phan Thiết, Vũng Tàu |
| `/room-types/[roomTypeCode]` | Trang nội dung hạng phòng | Mô tả, diện tích, loại giường, sức chứa, view, tiện nghi, gallery, chính sách, CTA xem giá | 5 hạng: STD, SUP, DLX, FAM, DOR |
| `/gallery` | Thư viện ảnh toàn chuỗi | Bộ ảnh theo cơ sở/chủ đề, lightbox, bộ lọc | Ảnh hiện có + bộ ảnh bổ sung |
| `/dining` | Ẩm thực | Nhà hàng, bar, beach club, món/điểm nhấn, giờ phục vụ | Nội dung minh hoạ có kiểm soát |
| `/experiences` | Trải nghiệm và wellness | Trải nghiệm địa phương, wellness, hoạt động gia đình | Nội dung minh hoạ có kiểm soát |
| `/offers` | Ưu đãi | Gói ưu đãi, điều kiện, CTA sang tìm phòng | Không hard-code giá bán |
| `/getting-here` | Di chuyển và liên hệ | Đường đến, sân bay, xe, bản đồ, liên hệ | Dữ liệu tĩnh |

**Không đổi route `/rooms/[roomTypeId]`**: route này tiếp tục là `SCR-03` trong luồng đặt phòng và cần `propertyId`, ngày, số khách. Trang nội dung phòng dùng route riêng để tránh trộn hai mục đích.

### Quy mô nội dung ban đầu

- **3 trang cơ sở**.
- **5 trang hạng phòng dùng chung toàn chuỗi**; các khác biệt theo cơ sở để giai đoạn sau.
- **5 trang nội dung cấp chuỗi**: gallery, dining, experiences, offers, getting here.

Tổng cộng khoảng **13 trang nội dung mới**, không tính các route giao dịch hiện có.

Nếu cần khác biệt hoàn toàn theo cơ sở, có thể nhân thành 15 trang phòng; chỉ nên làm khi có ảnh và mô tả thật cho từng tổ hợp.

## 4. Mô hình nội dung tĩnh

Đặt dữ liệu trong `apps/customer-web/src/content/`, không viết trực tiếp trong component.

```ts
interface PropertyContent {
  slug: string;
  name: string;
  summary: string;
  paragraphs: readonly string[];
  location: { address: string; mapUrl?: string };
  highlights: readonly string[];
  amenities: readonly string[];
  galleryIds: readonly string[];
  featuredRoomCodes: readonly string[];
  seo: { title: string; description: string };
}

interface RoomTypeContent {
  code: 'STD' | 'SUP' | 'DLX' | 'FAM' | 'DOR';
  name: string;
  summary: string;
  description: readonly string[];
  sizeSqm?: number;
  bedConfig: string;
  maxAdults: number;
  maxChildren: number;
  view?: string;
  amenities: readonly string[];
  galleryIds: readonly string[];
  seo: { title: string; description: string };
}
```

Quy tắc dữ liệu:

- Giá, tồn phòng và chính sách áp dụng cho một kỳ cụ thể **không** lưu trong content tĩnh.
- Giá “từ” chỉ hiển thị nếu lấy được từ API hoặc ghi rõ là dữ liệu minh hoạ.
- `galleryIds` trỏ tới manifest ảnh có mã, alt và nguồn; không hotlink ảnh bên ngoài.
- Nội dung chưa có dữ liệu thật phải đánh dấu `illustrative: true` và hiển thị ghi chú.
- Mọi CTA đặt phòng phải mang `propertyId`/`roomTypeCode`, ngày và số khách sang luồng hiện có.

## 5. Thành phần giao diện cần bổ sung

- `EditorialHero`: ảnh lớn, tiêu đề, mô tả ngắn, CTA nhưng không thay thế khối tìm phòng ở trang chủ.
- `Breadcrumbs`: điều hướng cơ sở → phòng/chủ đề.
- `GalleryGrid` + lightbox dùng bàn phím.
- `RoomSpecList`: diện tích, giường, sức chứa, view, tiện nghi.
- `InfoTabs` hoặc các section có mục lục trong trang cơ sở.
- `StickyBookingCta`: CTA đặt phòng trên mobile, không che nội dung.
- `RelatedRooms`, `RelatedExperiences`.
- `FaqList` và `JsonLd` cho `Hotel`, `HotelRoom`, `BreadcrumbList`.

Ưu tiên section ngữ nghĩa và component server; chỉ dùng client component cho gallery/lightbox, tab và CTA tương tác.

## 6. Tích hợp với luồng đặt phòng

- Trang cơ sở/phòng giữ CTA “Xem phòng trống” hoặc “Xem giá từng đêm”.
- Nếu chưa có ngày, CTA đưa về trang chủ và focus khối tìm phòng; không tự bịa tồn kho.
- Khi đã có ngữ cảnh ngày, CTA chuyển thẳng sang `/rooms/[roomTypeId]` hiện có.
- Không hiển thị tổng tiền hoặc mốc huỷ cố định trên trang nội dung; các con số đó thuộc báo giá.
- Link ngược từ màn chi tiết báo giá về trang nội dung phòng/cơ sở để khách đọc thêm.

## 7. SEO, accessibility và nội dung

- Mỗi trang có title, description, canonical và Open Graph riêng.
- Ảnh có alt thật, kích thước, `loading="lazy"` trừ ảnh LCP.
- Heading theo một `h1`, không nhảy cấp; gallery có mô tả và điều khiển bàn phím.
- Không dùng màu làm tín hiệu duy nhất; giữ tương phản AA.
- Nội dung minh hoạ phải có ghi chú rõ; không dùng số liệu, tiện nghi hoặc giải thưởng không có nguồn.
- Chuẩn bị cấu trúc i18n từ đầu: khóa nội dung không gắn cứng tiếng Việt trong JSX.

## 8. Các giai đoạn triển khai

1. **Chốt IA và mô hình dữ liệu:** route, quy mô 3+5 hay 3+15 trang, quy tắc nội dung minh hoạ.
2. **Dựng 1 trang cơ sở mẫu và 1 trang phòng mẫu:** hoàn chỉnh component, metadata, responsive, a11y.
3. **Nhân nội dung cho 3 cơ sở và 5 hạng phòng:** bổ sung ảnh, alt, nguồn.
4. **Dựng 5 trang cấp chuỗi:** gallery, dining, experiences, offers, getting here.
5. **Nối CTA với luồng tìm phòng/báo giá:** kiểm tra query và deep link.
6. **Hoàn thiện SEO, JSON-LD, kiểm thử và UAT nội dung.**

## 9. Tiêu chí nghiệm thu

- Có đủ route và nội dung theo IA đã chốt; không trang nào là placeholder rỗng.
- Trang cơ sở và trang phòng truy cập được độc lập, không bắt buộc tham số tìm phòng.
- CTA từ nội dung sang báo giá giữ đúng cơ sở, hạng phòng, ngày và số khách.
- Không có giá/tồn phòng tự tính ở lớp nội dung.
- Ảnh có nguồn, alt và trạng thái minh hoạ; không hotlink.
- Không tràn ngang ở 360 px; axe không có lỗi serious/critical.
- Metadata, canonical, Open Graph và breadcrumb JSON-LD hợp lệ.
- `pnpm --filter @pinehill/customer-web typecheck`, unit test, build và E2E liên quan đều đạt.

## 10. Ngoài phạm vi

- CMS quản trị nội dung và quy trình biên tập.
- API trả mô tả/tiện nghi/ảnh động theo cơ sở và hạng phòng.
- Đặt phòng đa tiền tệ hoặc chuyển đổi ngoại tệ.
- Trang hội viên, đánh giá, blog dài kỳ hoặc nội dung do người dùng tạo.

## 11. Điểm cần lead quyết

1. Dùng 5 trang hạng phòng dùng chung hay 15 trang riêng theo cơ sở?
2. Có chấp nhận nội dung/ảnh minh hoạ trong PR demo hay chỉ nhận nội dung thật?
3. Ưu tiên trước nhóm trang nào: cơ sở, phòng, hay trải nghiệm/ẩm thực?
4. Ai chịu trách nhiệm duyệt nội dung và bản quyền ảnh trước khi phát hành?
