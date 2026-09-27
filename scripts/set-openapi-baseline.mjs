#!/usr/bin/env node
/**
 * Chốt bản nền hợp đồng sau khi thay đổi phá vỡ đã được duyệt và bump version.
 * Chạy: `pnpm openapi:baseline` (sau `pnpm openapi:generate`).
 */
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = path.join(root, 'packages/contracts/openapi.json');
const target = path.join(root, 'packages/contracts/openapi.baseline.json');
copyFileSync(source, target);
process.stdout.write(`Đã chốt bản nền hợp đồng: ${path.relative(root, target)}\n`);
