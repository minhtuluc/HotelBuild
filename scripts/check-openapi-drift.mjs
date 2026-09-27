#!/usr/bin/env node
/**
 * Chốt hợp đồng API: bản OpenAPI đã commit phải trùng bản sinh lại từ zod (QT §12.1.8).
 * Lệch nghĩa là hợp đồng đã đổi mà không cập nhật artefact — CI phải đỏ.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const committedPath = path.join(root, 'packages/contracts/openapi.json');
const tsx = path.join(root, 'node_modules/.bin/tsx');
const generate = path.join(root, 'packages/contracts/src/openapi/generate.ts');

const temporaryDir = mkdtempSync(path.join(tmpdir(), 'pinehill-openapi-'));
const generatedPath = path.join(temporaryDir, 'openapi.json');

try {
  execFileSync(tsx, [generate, generatedPath], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
  const committed = readFileSync(committedPath, 'utf8');
  const generated = readFileSync(generatedPath, 'utf8');
  if (committed !== generated) {
    console.error(
      'OpenAPI drift: bản commit khác bản sinh từ zod.\n' +
        'Chạy `pnpm openapi:generate` và gửi kèm diff hợp đồng trong cùng PR (nếu là thay đổi phá vỡ, phải bump version và báo trước 24 giờ).',
    );
    process.exitCode = 1;
  } else {
    const paths = Object.keys(JSON.parse(committed).paths ?? {}).length;
    console.log(`OpenAPI: khớp bản commit (${paths} path).`);
  }
} finally {
  rmSync(temporaryDir, { recursive: true, force: true });
}
