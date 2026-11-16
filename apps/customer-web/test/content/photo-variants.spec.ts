import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOME_TOC } from '../../src/app/(guest)/home-toc';
import { parseManifest, photoSrcSet } from '../../src/lib/photos';

/** HB-325 — ảnh nhiều cỡ cho ô ảnh trang khách (LCP mobile) và mục lục trang chủ (UX-06). */

const DIR = fileURLToPath(new URL('../../public/images/pine-hill/', import.meta.url));
const ORIGINAL = /^([a-z0-9-]+?)\.(webp|avif|jpe?g|png)$/i;
const VARIANT = /-\d+w\.webp$/;

const MANIFEST = parseManifest(
  JSON.stringify({
    'ga-DL-poster': { file: 'ga-DL-poster.webp', width: 1200, variants: [640, 960] },
    'hang-STD': { file: 'hang-STD.webp', width: 800, variants: [640] },
    sai: { file: 7, width: 'x' },
  }),
);

/** Một ảnh gốc: có mục trong bảng, mọi bản nhỏ ghi trong bảng có thật, ảnh rộng hơn 640px có bản 640w. */
function expectVariants(manifest: ReturnType<typeof parseManifest>, file: string): void {
  const id = ORIGINAL.exec(file)?.[1] ?? '';
  const entry = manifest[id];
  expect(entry, file).toBeDefined();
  if (entry === undefined) return;
  expect(entry.file).toBe(file);
  for (const width of entry.variants)
    expect(existsSync(`${DIR}${id}-${width}w.webp`), `${id}-${width}w`).toBe(true);
  if (entry.width > 640) expect(entry.variants, file).toContain(640);
}

describe('srcset', () => {
  it('gồm bản nhỏ có thật trên đĩa, cộng ảnh gốc ở bề rộng thật', () => {
    expect(photoSrcSet('/images/pine-hill/ga-DL-poster.webp', MANIFEST, () => true)).toBe(
      '/images/pine-hill/ga-DL-poster-640w.webp 640w, /images/pine-hill/ga-DL-poster-960w.webp 960w, /images/pine-hill/ga-DL-poster.webp 1200w',
    );
  });

  it('bỏ bản nhỏ đã mất; không còn bản nào thì không có srcset', () => {
    const only640 = (p: string): boolean => p.endsWith('-640w.webp');
    expect(photoSrcSet('/images/pine-hill/ga-DL-poster.webp', MANIFEST, only640)).toBe(
      '/images/pine-hill/ga-DL-poster-640w.webp 640w, /images/pine-hill/ga-DL-poster.webp 1200w',
    );
    expect(
      photoSrcSet('/images/pine-hill/ga-DL-poster.webp', MANIFEST, () => false),
    ).toBeUndefined();
  });

  it('ảnh không có trong bảng, chưa có ảnh, hay chưa chạy script thì không có srcset', () => {
    expect(photoSrcSet('/images/pine-hill/moi.webp', MANIFEST, () => true)).toBeUndefined();
    expect(photoSrcSet(undefined, MANIFEST, () => true)).toBeUndefined();
    expect(photoSrcSet('/images/pine-hill/hang-STD.webp', null, () => true)).toBeUndefined();
    expect(Object.keys(MANIFEST)).toEqual(['ga-DL-poster', 'hang-STD']);
  });

  it('mọi ảnh gốc đã có bản nhỏ và có mặt trong variants.json (script đã chạy sau lần thay ảnh gần nhất)', () => {
    const manifest = parseManifest(readFileSync(`${DIR}variants.json`, 'utf8'));
    const originals = readdirSync(DIR).filter((file) => ORIGINAL.test(file) && !VARIANT.test(file));
    expect(originals.length).toBeGreaterThan(0);
    for (const file of originals) expectVariants(manifest, file);
  });
});

describe('mục lục trang chủ', () => {
  it('mỗi mục trỏ tới một dải có thật trên trang chủ, không trùng', () => {
    const page = readFileSync(
      fileURLToPath(new URL('../../src/app/(guest)/page.tsx', import.meta.url)),
      'utf8',
    );
    const ids = HOME_TOC.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(page, id).toContain(`id="${id}"`);
  });
});
