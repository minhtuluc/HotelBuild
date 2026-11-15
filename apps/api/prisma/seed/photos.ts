/**
 * HB-244 — ảnh minh hoạ cho môi trường dev/demo, khớp đúng các file tĩnh mà web khách đang dùng
 * (`apps/customer-web/public/images/pine-hill/`, nguồn và giấy phép ở `docs/04-thiet-ke/anh-trang-khach.md`).
 * Đây **không** phải ảnh thật của Pine Hill. Chỉ chèn cho cơ sở/loại phòng **chưa có ảnh nào**, nên chạy lại
 * hoặc chạy sau khi OWNER đã thay ảnh qua `PUT …/photos` không ghi đè gì. Không chạy khi `NODE_ENV=production`.
 */
import type pg from 'pg';

type Queryable = Pick<pg.Client, 'query'>;

interface DemoPhoto {
  readonly file: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

const image = (file: string, alt: string, width: number, height: number): DemoPhoto => ({
  file,
  alt,
  width,
  height,
});

/** Ảnh cơ sở theo mã cơ sở: áp phích ga, phòng, cảnh quanh (đúng thứ tự hiển thị). */
export const PROPERTY_PHOTOS: Readonly<Record<string, readonly DemoPhoto[]>> = {
  'CS-01': [
    image(
      'ga-DL-poster.webp',
      'Biệt thự gỗ bên hồ bơi giữa vườn cây, ảnh minh hoạ cho Pine Hill Đà Lạt',
      1200,
      1600,
    ),
    image(
      'ga-DL-phong.webp',
      'Phòng ngủ gỗ rộng với giường đôi và khu ghế ngồi, ảnh minh hoạ',
      1200,
      900,
    ),
    image('ga-DL-canh.webp', 'Con đường trong rừng thông Châu Sơn, Lâm Đồng', 1200, 900),
  ],
  'CS-02': [
    image(
      'ga-VT-poster.webp',
      'Biệt thự hồ bơi giữa đồi cây, ảnh minh hoạ cho Pine Hill Vũng Tàu',
      1200,
      1600,
    ),
    image(
      'ga-VT-phong.webp',
      'Phòng ngủ gỗ với giường đôi và hai ghế bên cửa sổ, ảnh minh hoạ',
      1200,
      900,
    ),
    image('ga-VT-canh.webp', 'Hoàng hôn trên vịnh Vũng Tàu', 1200, 900),
  ],
  'CS-03': [
    image(
      'ga-PT-poster.webp',
      'Nhà hàng bên mặt nước dưới đồi xanh, ảnh minh hoạ cho Pine Hill Phan Thiết',
      1200,
      1600,
    ),
    image('ga-PT-phong.webp', 'Phòng ngủ gỗ rộng nhìn ra vườn, ảnh minh hoạ', 1200, 900),
    image('ga-PT-canh.webp', 'Cây trên đồi cát Mũi Né, Phan Thiết', 1200, 900),
  ],
};

/** Ảnh hạng phòng theo mã loại phòng (dùng chung cho cả ba cơ sở ở bản demo). */
export const ROOM_TYPE_PHOTOS: Readonly<Record<string, DemoPhoto>> = {
  STD: image(
    'hang-STD.webp',
    'Cận cảnh giường đôi trong phòng ngủ gỗ, ảnh minh hoạ hạng Standard',
    800,
    600,
  ),
  SUP: image(
    'hang-SUP.webp',
    'Phòng ngủ gỗ có giường đôi, bàn làm việc và khu ghế ngồi, ảnh minh hoạ hạng Superior',
    800,
    600,
  ),
  DLX: image(
    'hang-DLX.webp',
    'Phòng ngủ có hai giường và khu ghế ngồi nhìn ra biển, ảnh minh hoạ hạng Deluxe',
    800,
    600,
  ),
  FAM: image(
    'hang-FAM.webp',
    'Phòng ngủ có hai giường, bàn ghế và cửa sổ hướng biển, ảnh minh hoạ hạng Family',
    800,
    600,
  ),
  DOR: image(
    'hang-DOR.webp',
    'Phòng dorm với dãy giường tầng có rèm che và ngăn kéo, ảnh minh hoạ',
    800,
    600,
  ),
};

const url = (photo: DemoPhoto) => `/images/pine-hill/${photo.file}`;

/** Trả số dòng ảnh đã chèn (0 khi mọi cơ sở/loại phòng đã có ảnh). */
export async function seedDemoPhotos(db: Queryable): Promise<number> {
  let inserted = 0;
  for (const [code, photos] of Object.entries(PROPERTY_PHOTOS)) {
    // Quyết một lần cho cả bộ: cơ sở đã có ảnh (do OWNER đặt hoặc lần seed trước) thì bỏ qua toàn bộ.
    const target = await db.query<{ id: string }>(
      `SELECT p.id FROM properties p
        WHERE p.code = $1 AND NOT EXISTS (SELECT 1 FROM property_photos x WHERE x.property_id = p.id)`,
      [code],
    );
    const propertyId = target.rows[0]?.id;
    if (propertyId === undefined) continue;
    for (const [position, photo] of photos.entries()) {
      await db.query(
        `INSERT INTO property_photos(property_id, position, url, alt, width, height)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [propertyId, position, url(photo), photo.alt, photo.width, photo.height],
      );
      inserted += 1;
    }
  }
  for (const [code, photo] of Object.entries(ROOM_TYPE_PHOTOS)) {
    const result = await db.query(
      `INSERT INTO room_type_photos(room_type_id, position, url, alt, width, height)
       SELECT t.id, 0, $2, $3, $4, $5 FROM room_types t
        WHERE t.code = $1 AND NOT EXISTS (SELECT 1 FROM room_type_photos x WHERE x.room_type_id = t.id)`,
      [code, url(photo), photo.alt, photo.width, photo.height],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}
