# Ảnh cho trang khách Pine Hill: chỗ đặt và nội dung cần chụp

Trang khách dùng thế giới "tuyến Pine Hill" (vé tàu, bảng ga, áp phích ga). Ảnh thật đi vào các ô cố định dưới đây. Màn mở đầu (bảng ga + tấm vé tìm phòng) **cố ý không có ảnh**: tấm vé là nội dung chính, một ảnh lớn ở đó sẽ đẩy form tìm phòng xuống và đưa trang về khuôn "ảnh hero + thanh tìm kiếm" của mọi trang đặt phòng.

## Ảnh minh hoạ đang dùng cho bản đồ án

Bản dựng đồ án hiện dùng ảnh minh hoạ để kiểm tra bố cục, **không phải ảnh thật của các cơ sở Pine Hill**. Trang hiển thị câu ghi chú tương ứng; khi phát hành phải thay toàn bộ bằng ảnh thật theo brief bên dưới.

| Mã ô | File nguồn | Nguồn / ghi chú |
|---|---|---|
| `ga-DL-poster` | `files__amanoi_vietnam_-_accommodation_forest_wellness_pool_villa_exterior_-_swimming_pool.webp` | Amanoi / aman.com; ảnh minh hoạ nội bộ cho đồ án. |
| `ga-DL-phong` | `files__Ocean_Pavilion_Amanoi_Vietnam_3.webp` | Amanoi / aman.com; ảnh minh hoạ nội bộ cho đồ án. |
| `ga-DL-canh` | [Pine forest in Don Duong, Lam Dong, Vietnam](https://commons.wikimedia.org/wiki/File:Pine_forest_in_Don_Duong,_Lam_Dong,_Vietnam.jpg) | FreemanKi, CC BY-SA 4.0; đã crop 4:3 và chuyển WebP. |
| `ga-PT-poster` | `files__amanoi_vietnam_-_beach_club_exterior.webp` | Amanoi / aman.com; ảnh minh hoạ nội bộ cho đồ án. |
| `ga-PT-phong` | `files__Amanoi_Vietnam_-_Ocean_Pool_Family_Villa_-_Master_bedroom.webp` | Amanoi / aman.com; ảnh minh hoạ nội bộ cho đồ án. |
| `ga-PT-canh` | [Vietnam, Mui Ne sand dunes, trees on the sand](https://commons.wikimedia.org/wiki/File:Vietnam,_Mui_Ne_sand_dunes,_trees_on_the_sand.jpg) | Vyacheslav Argenberg, CC BY 4.0; đã crop 4:3 và chuyển WebP. |
| `ga-VT-poster` | `files__Amanoi_Vietnam_-_Accommodation_One-bedroom_Amanoi_Ocean_Pool_Residence_Portrait.webp` | Amanoi / aman.com; ảnh minh hoạ nội bộ cho đồ án. |
| `ga-VT-phong` | `files__Amanoi_Vietnam_-_Accommodation_Pavilion_Villa_Bedroom__Original_12380_4.webp` | Amanoi / aman.com; ảnh minh hoạ nội bộ cho đồ án. |
| `ga-VT-canh` | [Vũng Tàu sunset](https://commons.wikimedia.org/wiki/File:V%C5%A9ng_T%C3%A0u_sunset.jpg) | Kwozyn, CC BY-SA 4.0; đã crop 4:3 và chuyển WebP. |
| `hang-STD` | `files__Amanoi_Mountain-Pool-Villa-1.webp` | Amanoi / aman.com; ảnh minh hoạ nội bộ cho đồ án. |
| `hang-SUP` | `files__Ocean_Pavilion_Amanoi_Vietnam_2.webp` | Amanoi / aman.com; ảnh minh hoạ nội bộ cho đồ án. |
| `hang-DLX` | `files__Amanoi_Vietnam_-_Ocean_Pool_Family_Villa_bedroom.webp` | Amanoi / aman.com; ảnh minh hoạ nội bộ cho đồ án. |
| `hang-FAM` | `files__Amanoi_Vietnam_-_Four_Bedroom_Ocean_Pool_Family_Residence_bedroom.webp` | Amanoi / aman.com; ảnh minh hoạ nội bộ cho đồ án. |
| `hang-DOR` | [A Room in a Hostel](https://www.pexels.com/photo/a-room-in-a-hostel-5137980/) | cottonbro studio, Pexels License; đã crop 4:3 và chuyển WebP. |
| `chia-se` | `files__amanoi_vietnam_-_resort_exterior_aerial_shots_52230_1.webp` | Amanoi / aman.com; ảnh minh hoạ nội bộ cho đồ án. |

Các file Amanoi lấy từ bộ local `amanoi-dig`; URL trang nguồn gốc của từng file nằm trong `Impeccable/amanoi-dig/amanoi-dig/data/images_manifest.json`. Ảnh Amanoi không kèm giấy phép tái sử dụng thương mại: chỉ dùng làm tư liệu minh hoạ nội bộ cho đồ án, không phát hành thương mại. Ảnh Wikimedia Commons giữ điều kiện ghi công và chia sẻ tương tự của giấy phép tương ứng; ảnh Pexels dùng theo Pexels License.

## Cách thêm ảnh

1. Đặt tên file đúng **mã ô** (cột đầu tiên bên dưới), đuôi `.webp` (ưu tiên), `.avif`, `.jpg` hoặc `.png`.
2. Chép vào `apps/customer-web/public/images/pine-hill/`.
3. Tải lại trang. Không cần sửa mã: trang tự tìm file theo mã ô.
4. Sửa câu `alt` của ô đó trong `apps/customer-web/src/content/photo-slots.ts` cho khớp ảnh thật.

Xem trước mọi ô (kể cả ô chưa có ảnh): mở trang chủ với `?anh=1`, ví dụ `http://localhost:3001/?anh=1`. Ô trống hiện khung đỏ đứt nét ghi mã, tỉ lệ, kích thước và việc cần chụp.

Ô chưa có ảnh khi chạy thật: áp phích ga quay về tranh SVG minh hoạ; các ô còn lại tự ẩn.

## Danh sách ô ảnh (15 ô)

### Dải "Ba ga trên tuyến" (mỗi ga 3 ô)

| Mã ô | Vị trí | Tỉ lệ | Tối thiểu (px) | Cần chụp |
|---|---|---|---|---|
| `ga-DL-poster` | Áp phích ga Đà Lạt | 3:4 dọc | 1200 × 1600 | Mặt tiền cơ sở giữa đồi thông, sáng sớm còn sương, thấy rõ lối vào |
| `ga-DL-phong` | Ảnh nhỏ 1 dưới thông tin ga Đà Lạt | 4:3 | 1200 × 900 | Phòng Deluxe hoặc Family đã dọn, ánh sáng tự nhiên, thấy giường và cửa sổ nhìn ra thông |
| `ga-DL-canh` | Ảnh nhỏ 2 dưới thông tin ga Đà Lạt | 4:3 | 1200 × 900 | Đồi thông hoặc hồ gần cơ sở, đúng cảnh khách thấy khi bước ra cửa |
| `ga-PT-poster` | Áp phích ga Phan Thiết | 3:4 dọc | 1200 × 1600 | Mặt tiền hướng biển hoặc lối ra biển, nắng chiều |
| `ga-PT-phong` | Ảnh nhỏ 1, ga Phan Thiết | 4:3 | 1200 × 900 | Phòng có ban công hoặc cửa sổ hướng biển, rèm mở, ban ngày |
| `ga-PT-canh` | Ảnh nhỏ 2, ga Phan Thiết | 4:3 | 1200 × 900 | Đồi cát hoặc bãi biển gần nhất lúc bình minh; người ở xa, không rõ mặt |
| `ga-VT-poster` | Áp phích ga Vũng Tàu | 3:4 dọc | 1200 × 1600 | Mặt tiền cơ sở, thấy biển hoặc núi Nhỏ phía sau nếu có |
| `ga-VT-phong` | Ảnh nhỏ 1, ga Vũng Tàu | 4:3 | 1200 × 900 | Phòng Standard hoặc Superior, góc rộng từ cửa vào, ban ngày |
| `ga-VT-canh` | Ảnh nhỏ 2, ga Vũng Tàu | 4:3 | 1200 × 900 | Biển hoặc đường lên hải đăng gần cơ sở, chiều muộn |

Áp phích có dải chữ đen ở đáy (tên ga, mô tả ngắn) che khoảng 18% chiều cao ảnh: để chủ thể ở 2/3 phía trên.

### Dải "Hạng phòng" (mỗi hạng 1 ô; cũng là ảnh nhỏ trong bảng kết quả tìm phòng)

| Mã ô | Tỉ lệ | Tối thiểu (px) | Cần chụp |
|---|---|---|---|
| `hang-STD` | 4:3 | 800 × 600 | Phòng đôi gọn, chụp từ góc cửa, thấy toàn bộ giường đôi và lối đi |
| `hang-SUP` | 4:3 | 800 × 600 | Phòng đôi rộng hơn, thấy khoảng trống thêm (ghế, bàn) so với Standard |
| `hang-DLX` | 4:3 | 800 × 600 | Phòng ba người, thấy rõ chỗ nằm cho người thứ ba |
| `hang-FAM` | 4:3 | 800 × 600 | Phòng bốn người, thấy cả hai giường hoặc giường đôi + giường tầng |
| `hang-DOR` | 4:3 | 800 × 600 | Phòng 6 giường tầng, thấy rèm che từng giường, tủ khoá cá nhân nếu có |

Ảnh hạng phòng dùng chung cho cả ba cơ sở. Chọn phòng tiêu biểu nhất; nếu ba cơ sở khác nhau nhiều, xem mục "Cần backend" bên dưới.

### Ảnh chia sẻ link

| Mã ô | Tỉ lệ | Kích thước | Cần chụp |
|---|---|---|---|
| `chia-se` | 1200:630 ngang | 1200 × 630 | Một ảnh ngang đẹp nhất trong ba cơ sở; hiện khi gửi link qua Zalo, Facebook, Messenger |

## Hướng chụp chung

- **Ảnh thật của Pine Hill khi phát hành.** Bản phát hành không dùng ảnh stock, ảnh của khách sạn khác hay ảnh lấy từ website khác. Bản đồ án hiện dùng ngoại lệ minh hoạ có ghi nguồn ở mục “Ảnh minh hoạ đang dùng cho bản đồ án”; toàn bộ phải được thay trước khi phát hành.
- **Ánh sáng tự nhiên**, không hậu kỳ màu đậm, không HDR. Trang đã có nhiều màu (giấy vé hồng, bảng ga đen, mực xanh); ảnh nên trung thực, hơi ấm là đủ.
- **Đường chân trời thẳng**, đường dọc của tường và cửa thẳng đứng (chỉnh phối cảnh nếu chụp góc rộng).
- **Phòng dọn sẵn như lúc khách nhận phòng:** giường phẳng, không đồ cá nhân, không dây điện lộ, đèn trần tắt nếu đủ sáng.
- **Con người:** được phép nếu ở xa, quay lưng hoặc không nhận ra mặt. Ảnh có khuôn mặt rõ phải có giấy đồng ý của người trong ảnh.
- **Không chữ trong ảnh** (biển hiệu lớn, logo đối tác, watermark), vì trang đã đặt chữ lên áp phích.

## Thông số file

- Định dạng `.webp` chất lượng 80–85 (hoặc `.avif`); `.jpg` nếu chưa có công cụ chuyển.
- Dung lượng mục tiêu: áp phích ≤ 350 KB, ảnh 4:3 ≤ 200 KB, ảnh hạng phòng ≤ 120 KB.
- Cắt đúng tỉ lệ trước khi chép vào; trang dùng `object-fit: cover` nên ảnh sai tỉ lệ sẽ bị cắt mép.
- Hệ màu sRGB, xoá dữ liệu GPS trong EXIF trước khi đưa lên.

## Cần backend (chưa làm được ở frontend)

- **Ảnh theo từng cơ sở và từng hạng phòng** (vd. Deluxe ở Đà Lạt khác Deluxe ở Vũng Tàu) và **bộ ảnh ở màn chi tiết phòng (SCR-03)** cần hợp đồng API trả danh sách ảnh cho loại phòng. Hợp đồng hiện tại không có trường ảnh, và màn chi tiết phòng chỉ biết `roomTypeId` (khác nhau giữa các cơ sở), nên không thể gắn ảnh tĩnh theo mã. Đề xuất ghi tại [YEU-CAU-API-TU-FRONTEND.md](../../YEU-CAU-API-TU-FRONTEND.md).
