/**
 * Tìm ảnh thật cho một ô ảnh: chỉ chạy phía máy chủ (đọc thư mục `public/images/pine-hill/`).
 * Không có file thì trả `null` để trang dùng tranh minh hoạ hoặc ẩn ô.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

const EXTENSIONS = ['webp', 'avif', 'jpg', 'jpeg', 'png'] as const;
const PUBLIC_DIR_CANDIDATES = [
  path.join(process.cwd(), 'public'),
  path.join(process.cwd(), 'apps', 'customer-web', 'public'),
];

function publicDir(): string | null {
  return PUBLIC_DIR_CANDIDATES.find((dir) => existsSync(dir)) ?? null;
}

/** Đường dẫn công khai `/images/pine-hill/<id>.<ext>` nếu file tồn tại. */
export function photoSrc(id: string): string | null {
  const root = publicDir();
  if (root === null || !/^[a-z0-9-]+$/i.test(id)) return null;
  for (const ext of EXTENSIONS) {
    const file = path.join(root, 'images', 'pine-hill', `${id}.${ext}`);
    if (existsSync(file)) return `/images/pine-hill/${id}.${ext}`;
  }
  return null;
}

/** Bảng mã → đường dẫn cho các ô đang có ảnh. */
export function availablePhotos(ids: readonly string[]): Readonly<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const id of ids) {
    const src = photoSrc(id);
    if (src !== null) found[id] = src;
  }
  return found;
}
