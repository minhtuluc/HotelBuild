#!/usr/bin/env node
/**
 * Cổng thay đổi phá vỡ hợp đồng (QT §12.1.8, api.md §7).
 * So `packages/contracts/openapi.json` với bản nền đã phát hành `openapi.baseline.json`.
 * Thay đổi phá vỡ ⇒ CI đỏ, buộc bump phiên bản và báo trước 24 giờ.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareContracts } from './lib/openapi-diff.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const baselinePath = path.join(root, 'packages/contracts/openapi.baseline.json');
const candidatePath = path.join(root, 'packages/contracts/openapi.json');

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
const { breaking, additive } = compareContracts(baseline, candidate);

const baselineVersion = baseline?.info?.version ?? '?';
const candidateVersion = candidate?.info?.version ?? '?';

if (breaking.length > 0) {
  console.error(
    `Hợp đồng có ${breaking.length} thay đổi phá vỡ so với bản nền ${baselineVersion}:\n${breaking.join('\n')}\n` +
      `Nếu đây là chủ đích: bump version hợp đồng (hiện tại ${candidateVersion}), cập nhật docs/04-thiet-ke/api.md, ` +
      `rồi chốt lại bản nền bằng \`pnpm openapi:baseline\`.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Hợp đồng: 0 thay đổi phá vỡ so với bản nền ${baselineVersion}` +
      (additive.length === 0 ? ' (không có thay đổi).' : `; ${additive.length} thay đổi tương thích.`),
  );
}
