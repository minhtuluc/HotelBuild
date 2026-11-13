---
version: 1
slug: "src-app-guest-page-tsx"
primary_target: "src/app/(guest)/page.tsx"
related_targets: []
---

# Surface brief: customer-web (khách đặt phòng)

Mode: Persuade. Khách nội địa đặt phòng trực tiếp ở 3 cơ sở Pine Hill, so giá với OTA. Việc: chọn cơ sở + ngày + số khách, xem giá từng đêm và mốc huỷ, giữ chỗ 10 phút, đặt cọc VNPay/MoMo. Giá, phần trăm hoàn, tình trạng phòng chỉ lấy từ API. Nội dung nơi chốn và tranh minh hoạ do agent viết, gom ở `src/content/demo-content.ts`, ghi rõ để thay.

## Direction contract

THESIS: Đặt phòng như mua vé trên "tuyến Pine Hill": ba cơ sở là ba ga, mỗi đêm là một chặng có giá in riêng trên vé, huỷ là trả vé theo giờ trước giờ tàu chạy. Từ chối: ảnh hero + thanh tìm kiếm nổi + hàng thẻ phòng bằng nhau; và từ chối cả bản trước (chữ trái, form phải, ba gạch đầu dòng).

OWN-WORLD: Giấy vé hồng in chìm hoa văn (#F0CDBF, sáng #F7E5DE) là nền chính; mực in xanh (#1B3A82) cho chữ in trên vé và nét kẻ; dấu đỏ (#B8341C) cho hành động và dấu bấm vé; bảng ga đen (#121614) chữ vàng hổ phách (#F2B632), xanh còn chỗ (#7CD08A). Chữ: Barlow Condensed cho bảng ga và tiêu đề, Roboto Mono cho trường in trên vé, Be Vietnam Pro cho đoạn văn. Đường kẻ đôi, răng cưa xé vé, lỗ bấm vé tròn.

STORY: Khách hiểu đây là đặt phòng 3 cơ sở; thấy mỗi đêm là một chặng có giá riêng, thấy trả vé được hoàn bao nhiêu theo giờ; tin vì mọi con số in ra từ hệ thống; giữ chỗ.

FIRST VIEWPORT: Đầu trang là dải bảng ga đen có wordmark và đồng hồ giờ VN. Nền vé hồng. Trái: tiêu đề cỡ lớn "Mỗi đêm một chặng." + đoạn dẫn + bảng ga đến (cơ sở thật từ API, giờ nhận/trả). Phải: tấm vé chính là form tìm phòng (trường in mono trong ô kẻ xanh), dải chặng các đêm cập nhật theo ngày, cuống vé xé được ghi mốc huỷ. Nút đỏ "Tìm phòng trống".

FORM: Vé tàu, vị trí 1/7 trong danh sách lượt tung lại (IMPECCABLE'S PICK, người dùng chọn). seed:5e574e4a60ea72c7
Raises: (sách lắp ráp) luồng đặt phòng 4 bước đánh số lớn. (tường hộp giày) mỗi hạng phòng một nhãn cùng lưới: mã, sức chứa, giường. (teletext) mỗi ga và hạng có mã ngắn ổn định. (cắt dán) cho phép áp phích lệch trục có chủ ý. (cracktro) một biến số duy nhất xếp hạng: chặng nào đắt hơn in đậm hơn.
Signature interaction: chặng các đêm in lên vé theo ngày chọn; bảng ga lật chữ khi tải; cuống vé có đường xé.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
