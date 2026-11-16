#!/usr/bin/env node
/**
 * Sinh ảnh nhiều cỡ cho ô ảnh trang khách (HB-325): với mỗi ảnh gốc trong `public/images/pine-hill/`, tạo bản
 * `<mã>-640w.webp` và `<mã>-960w.webp` (bỏ qua cỡ không nhỏ hơn ảnh gốc), rồi ghi `variants.json` để máy chủ
 * ghép `srcset` chỉ từ bản có thật. Ảnh gốc giữ nguyên làm `src` và làm cỡ lớn nhất của `srcset`.
 *
 * Chạy lại sau khi thả hay thay ảnh: `node apps/customer-web/scripts/photo-variants.mjs`. Không chạy thì trang
 * vẫn dùng ảnh gốc như trước (không có `srcset`), chỉ nặng hơn trên điện thoại.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/images/pine-hill',
);
const WIDTHS = [640, 960];
const QUALITY = 74;
const ORIGINAL = /^([a-z0-9-]+?)\.(webp|avif|jpe?g|png)$/i;
const VARIANT = /-\d+w\.webp$/;

const manifest = {};
for (const file of readdirSync(DIR).sort()) {
  if (VARIANT.test(file)) continue;
  const match = ORIGINAL.exec(file);
  if (match === null) continue;
  const id = match[1];
  const source = path.join(DIR, file);
  const { width = 0 } = await sharp(source).metadata();
  const variants = [];
  for (const target of WIDTHS) {
    if (target >= width) continue;
    await sharp(source)
      .resize({ width: target })
      .webp({ quality: QUALITY, effort: 6 })
      .toFile(path.join(DIR, `${id}-${target}w.webp`));
    variants.push(target);
  }
  manifest[id] = { file, width, variants };
  console.log(
    `${file}: ${width}px → ${variants.map((w) => `${w}w`).join(', ') || 'không cần bản nhỏ'}`,
  );
}
writeFileSync(path.join(DIR, 'variants.json'), `${JSON.stringify(manifest, null, 2)}\n`);
