/**
 * Sinh OpenAPI 3.1 từ zod schema (ADR-008). Chạy: `pnpm openapi:generate`.
 * Đầu ra phải tất định: CI so bản sinh mới với bản đã commit (scripts/check-openapi-drift.mjs).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.js';

export const CONTRACT_VERSION = '1.0.0';

export function buildDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Pine Hill Booking API',
      version: CONTRACT_VERSION,
      description:
        'Hợp đồng REST /api/v1. Nguồn chân lý thiết kế: docs/04-thiet-ke/api.md (F0: AUTH + system/health).',
    },
    // Path trong registry đã đầy đủ `/api/v1/...` theo api.md §2 — server không lặp prefix (F0-01).
    servers: [{ url: '/' }],
  });
}

/** Chuỗi JSON đã chuẩn hoá — dùng chung cho ghi tệp và kiểm drift. */
export function serializeDocument(): string {
  return `${JSON.stringify(buildDocument(), null, 2)}\n`;
}

const defaultPath = fileURLToPath(new URL('../../openapi.json', import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ?? defaultPath;
  const document = buildDocument();
  writeFileSync(target, serializeDocument(), 'utf8');
  process.stdout.write(
    `OpenAPI ${document.openapi}: ${Object.keys(document.paths ?? {}).length} path -> ${target}\n`,
  );
}
