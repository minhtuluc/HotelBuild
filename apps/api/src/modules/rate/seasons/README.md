# HB-054 — mùa & hệ số mùa (SCR-27, UC-RATE-02)

`GET /seasons` (MANAGER/OWNER) trả trang UUID cursor (`limit` mặc định 50, tối đa 100) các mùa **gắn cơ sở**
theo `propertyId`; `from`/`to` cắt theo khoảng giao nhau. MANAGER không khai `propertyId` chỉ thấy mùa
trong `propertyScope`, OWNER thấy mọi mùa gắn cơ sở. Mùa toàn chuỗi (`property_id IS NULL`) không đi
tuyến này vì `seasonSummarySchema` (HB-050) bắt `propertyId` khác rỗng — nợ hợp đồng đã nêu ở PR.

`POST /seasons` (OWNER, có `Idempotency-Key`, 201 rỗng như `createSeason` của `@pinehill/api-client`
chờ): kiểm ngày thật và `endDate >= startDate`, `priority` trong `smallint`, hệ số trong 0,10–5,00 của
hợp đồng và **tối đa 3 chữ số thập phân** (`numeric(5,3)` — nhiều hơn sẽ bị CSDL làm tròn im lặng).
Mùa **chồng lấn được phép** (BR-RATE-05): hai mùa cùng `priority` đang chồng nhau vẫn lưu, được ghi vào
`AuditLog` (`overlappingSamePrioritySeasonIds`) và màn hình được nhắc qua `warnings[]` của
`GET rate-calendar`. Việc chọn mùa thắng vẫn của engine HB-052: `priority` → khoảng hẹp hơn →
`createdAt` nhỏ hơn (TC-RATE-03). Tên mùa và mọi văn bản vận hành được che PII trước khi ghi.

`code`: `seasonCreateRequestSchema` (HB-050) không có trường này, màn SCR-27 cũng không quản, nhưng
`seasons.code` là `NOT NULL` với CHECK đúng 7 mã. `catalogue.ts` suy mã từ cửa sổ năm của BR-RATE-05 §4.2
theo `startDate`; SE-TET là cửa sổ không ghim theo dương lịch nên nhận khoảng 03/01–27/04, còn 04/05–31/05
ngoài mọi cửa sổ gom về `SE-LOW`. Mã này **không** tham gia tính giá (engine chỉ dùng khoảng ngày,
`priority`, hệ số) và không được trả ra API, nên đổi cách suy mã không đổi giá; muốn chọn tay thì phải
thêm trường `code` vào hợp đồng — việc của ticket hợp đồng, không thuộc HB-054.
