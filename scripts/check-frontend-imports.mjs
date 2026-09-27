#!/usr/bin/env node
/**
 * Hàng rào kiến trúc (ADR-018, kiến trúc §6): frontend không chạm CSDL/Redis/hàng đợi,
 * không import miền nghiệp vụ, không tự parse hợp đồng bằng zod, không đọc `process.env`
 * ngoài `apps/* /src/config`, không trộn nền tảng web ↔ native.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const FORBIDDEN_MODULES = new Map([
  ['@prisma/client', 'frontend không được chạm CSDL (ADR-018)'],
  ['ioredis', 'frontend không được chạm Redis (ADR-018)'],
  ['bullmq', 'frontend không được dùng hàng đợi (ADR-018)'],
  ['knex', 'frontend không được chạm CSDL (ADR-018)'],
  ['pg', 'frontend không được chạm CSDL (ADR-018)'],
  ['mysql2', 'frontend không được chạm CSDL (ADR-018)'],
  ['sqlite3', 'frontend không được chạm CSDL (ADR-018)'],
  ['@pinehill/domain', 'miền nghiệp vụ chỉ chạy authoritative ở API/worker (ADR-018)'],
  ['zod', 'validate ở biên thuộc packages/contracts (QT §2)'],
]);

const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*|require\(\s*|import\s+)['"]([^'"]+)['"]/g;

async function collectFiles(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', '.expo', 'dist', 'coverage'].includes(entry.name)) continue;
      found.push(...(await collectFiles(absolute)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      found.push(absolute);
    }
  }
  return found;
}

function isConfigFile(relativePath) {
  return /apps\/[^/]+\/src\/config\//.test(relativePath);
}

function platformOf(relativePath) {
  if (relativePath.startsWith('apps/customer-android') || relativePath.startsWith('apps/operations-android')) {
    return 'native';
  }
  if (relativePath.startsWith('packages/ui-native')) return 'native';
  if (
    relativePath.startsWith('apps/customer-web') ||
    relativePath.startsWith('apps/operations-web') ||
    relativePath.startsWith('packages/ui-web')
  ) {
    return 'web';
  }
  return 'shared';
}

const PROBLEM_MODULES = new Map([
  ['react-native', 'bề mặt web không dùng React Native (kiến trúc §6)'],
  ['react-dom', 'bề mặt native không dùng React DOM (kiến trúc §6)'],
  ['next', 'bề mặt native không dùng Next.js (kiến trúc §6)'],
]);

const scanRoots = [
  'apps/customer-web/src',
  'apps/customer-web/app',
  'apps/operations-web/src',
  'apps/operations-web/app',
  'apps/customer-android/src',
  'apps/customer-android/app',
  'apps/operations-android/src',
  'apps/operations-android/app',
  'packages/api-client/src',
  'packages/ui-web/src',
  'packages/ui-native/src',
];

const violations = [];

for (const scanRoot of scanRoots) {
  for (const file of await collectFiles(path.join(root, scanRoot))) {
    const relativePath = path.relative(root, file).split(path.sep).join('/');
    const lines = (await readFile(file, 'utf8')).split('\n');
    const platform = platformOf(relativePath);

    for (const [index, line] of lines.entries()) {
      const location = `${relativePath}:${index + 1}`;
      for (const match of line.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1];
        const reason = FORBIDDEN_MODULES.get(specifier);
        if (reason !== undefined) violations.push(`${location}: import '${specifier}' — ${reason}`);
        const platformReason = PROBLEM_MODULES.get(specifier);
        if (platformReason !== undefined && platform !== 'shared') {
          const samePlatform =
            (platform === 'web' && specifier === 'react-native') ||
            (platform === 'native' && (specifier === 'react-dom' || specifier === 'next'));
          if (samePlatform) violations.push(`${location}: import '${specifier}' — ${platformReason}`);
        }
      }
      if (/process\.env/.test(line) && !isConfigFile(relativePath)) {
        violations.push(`${relativePath}:${index + 1}: đọc process.env ngoài apps/*/src/config (kiến trúc §7.5)`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Ranh giới frontend: ${violations.length} vi phạm\n${violations.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Ranh giới frontend: ${scanRoots.length} gốc quét, 0 vi phạm.`);
}
