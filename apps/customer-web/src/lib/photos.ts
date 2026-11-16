/**
 * Tìm ảnh thật cho một ô ảnh: chỉ chạy phía máy chủ (đọc thư mục `public/images/pine-hill/`).
 * Không có file thì trả `null` để trang dùng tranh minh hoạ hoặc ẩn ô.
 */
import { existsSync, readFileSync } from 'node:fs';
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

/** Một mục của `variants.json` do `scripts/photo-variants.mjs` ghi (HB-325). */
export interface VariantEntry {
  readonly file: string;
  readonly width: number;
  readonly variants: readonly number[];
}

type Manifest = Readonly<Record<string, VariantEntry>>;

let manifest: Manifest | null | undefined;

function readManifest(): Manifest | null {
  if (manifest !== undefined) return manifest;
  const root = publicDir();
  try {
    manifest =
      root === null
        ? null
        : parseManifest(
            readFileSync(path.join(root, 'images', 'pine-hill', 'variants.json'), 'utf8'),
          );
  } catch {
    manifest = null;
  }
  return manifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Đọc `variants.json`, bỏ mục sai hình dạng. Thuần, để test. */
export function parseManifest(text: string): Manifest {
  const raw: unknown = JSON.parse(text);
  const out: Record<string, VariantEntry> = {};
  if (!isRecord(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const { file, width, variants } = value;
    if (typeof file !== 'string' || typeof width !== 'number' || !Array.isArray(variants)) continue;
    const widths = variants.filter(
      (item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0,
    );
    out[id] = { file, width, variants: widths };
  }
  return out;
}

function publicFileExists(publicPath: string): boolean {
  const root = publicDir();
  return root !== null && existsSync(path.join(root, ...publicPath.split('/').filter(Boolean)));
}

/**
 * `srcset` cho một ảnh (HB-325): các bản `-<w>w.webp` mà script đã sinh **và** còn trên đĩa, cộng ảnh gốc ở
 * bề rộng thật. Ảnh chưa chạy script (hoặc chưa chạy lại sau khi thay ảnh gốc) thì không có `srcset`: trang
 * dùng ảnh gốc như cũ, không bao giờ trỏ tới file không tồn tại.
 */
export function photoSrcSet(
  src: string | undefined,
  entries: Manifest | null = readManifest(),
  exists: (publicPath: string) => boolean = publicFileExists,
): string | undefined {
  if (src === undefined || entries === null) return undefined;
  const name = src.split('/').pop() ?? '';
  const entry = Object.entries(entries).find(([, value]) => value.file === name);
  if (entry === undefined) return undefined;
  const [id, { width, variants }] = entry;
  const dir = src.slice(0, src.length - name.length);
  const smaller = variants
    .filter((target) => target < width)
    .map((target) => ({ path: `${dir}${id}-${target}w.webp`, target }))
    .filter((item) => exists(item.path));
  if (smaller.length === 0) return undefined;
  return [...smaller.map((item) => `${item.path} ${item.target}w`), `${src} ${width}w`].join(', ');
}
