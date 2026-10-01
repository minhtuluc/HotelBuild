import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { evaluateScope, globToRegExp, needsCodexQc, parseNumstat, parseTicket, ticketIdFromBranch } from '../scripts/lib/scope.mjs';

const run = promisify(execFile);
const ticketText = (extra = '') => `---
id: HB-001
title: Khung màn hình tồn phòng
risk: R1
owner: deepseek
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/** # test do thợ viết
  - pnpm-lock.yaml
locked:
  - apps/operations-web/test/locked.spec.ts
${extra}---

# HB-001
`;

test('glob: * không qua thư mục, ** khớp 0..n thư mục, ký tự đặc biệt được thoát', () => {
  assert.ok(globToRegExp('apps/*/src/**').test('apps/customer-web/src/a/b.tsx'));
  assert.ok(!globToRegExp('apps/*/src/**').test('apps/x/y/src/a.ts'));
  assert.ok(globToRegExp('docs/**/*.md').test('docs/a.md'));
  assert.ok(globToRegExp('docs/**/*.md').test('docs/a/b/c.md'));
  assert.ok(!globToRegExp('package.json').test('packageXjson'));
  assert.ok(!globToRegExp('package.json').test('apps/x/package.json'));
});

test('ticket front matter: đọc danh sách, bỏ chú thích, mặc định max_lines, từ chối đặc tả hỏng', () => {
  const ticket = parseTicket(ticketText());
  assert.deepEqual(ticket.allow, ['apps/operations-web/src/**', 'apps/operations-web/test/**', 'pnpm-lock.yaml']);
  assert.equal(ticket.maxLines, 400);
  assert.deepEqual(ticket.unlock, []);
  assert.throws(() => parseTicket('# không front matter'), /front matter/);
  assert.throws(() => parseTicket(ticketText().replace('risk: R1', 'risk: R9')), /risk/);
  assert.throws(() => parseTicket(ticketText().replace('id: HB-001', 'id: HB-1')), /id/);
  assert.throws(() => parseTicket('---\nid: HB-002\nrisk: R0\n---\n'), /allow/);
  assert.throws(() => parseTicket(ticketText('max_lines: 0\n')), /max_lines/);
});

test('nhánh ticket và cổng Codex QC chỉ dành cho R2', () => {
  assert.equal(ticketIdFromBranch('ticket/HB-012-ton-phong'), 'HB-012');
  assert.equal(ticketIdFromBranch('ticket/HB-012'), 'HB-012');
  assert.equal(ticketIdFromBranch('lead/HB-012'), undefined);
  assert.equal(ticketIdFromBranch('ticket/HB-0123'), undefined);
  assert.equal(needsCodexQc({ risk: 'R2' }), true);
  assert.equal(needsCodexQc({ risk: 'R1' }), false);
  assert.equal(needsCodexQc(undefined), false);
});

test('phạm vi: ngoài allow, file khoá, file bảo vệ và diff quá lớn đều bị chặn; unlock mở đúng file', () => {
  const ticket = parseTicket(ticketText('max_lines: 50\nunlock:\n  - packages/contracts/openapi.baseline.json\n'));
  const change = (path, added = 1) => ({ path, added, deleted: 0 });
  assert.deepEqual(evaluateScope({ ticket, changes: [change('apps/operations-web/src/a.tsx'), change('pnpm-lock.yaml', 999)] }).errors, []);
  assert.equal(evaluateScope({ ticket, changes: [change('apps/api/prisma/schema.prisma', 999)] }).lines, 0, 'schema.prisma sinh tự động không tính vào max_lines');
  const { errors } = evaluateScope({ ticket, changes: [
    change('apps/customer-web/src/a.tsx'),
    change('apps/operations-web/test/locked.spec.ts'),
    change('docs/08-thi-cong/tickets/HB-001-x.md'),
    change('packages/contracts/openapi.baseline.json'),
    change('apps/operations-web/src/big.tsx', 60),
  ] });
  assert.equal(errors.length, 4);
  assert.match(errors[0], /ngoài phạm vi/);
  assert.match(errors[1], /file khoá/);
  assert.match(errors[2], /bảo vệ/);
  assert.match(errors[3], /max_lines 50/);
});

test('numstat: file nhị phân tính 0 dòng, giữ đường dẫn có tab/dấu cách', () => {
  assert.deepEqual(parseNumstat('3\t1\ta b.ts\n-\t-\tlogo.png\n'), [
    { path: 'a b.ts', added: 3, deleted: 1 }, { path: 'logo.png', added: 0, deleted: 0 }]);
});

test('CLI đọc ticket từ nhánh nền: sửa ticket trên nhánh không nới được phạm vi', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'scope-cli-'));
  const git = (...args) => run('git', args, { cwd: repo });
  const cli = (branch) => run(process.execPath, ['scripts/check-scope.mjs'], { cwd: repo, env: { ...process.env, SCOPE_BASE: 'main', SCOPE_BRANCH: branch, GITHUB_HEAD_REF: '' } });
  try {
    await mkdir(join(repo, 'scripts/lib'), { recursive: true });
    await mkdir(join(repo, 'docs/08-thi-cong/tickets'), { recursive: true });
    await mkdir(join(repo, 'apps/operations-web/src'), { recursive: true });
    await copyFile(fileURLToPath(new URL('../scripts/check-scope.mjs', import.meta.url)), join(repo, 'scripts/check-scope.mjs'));
    await copyFile(fileURLToPath(new URL('../scripts/lib/scope.mjs', import.meta.url)), join(repo, 'scripts/lib/scope.mjs'));
    await writeFile(join(repo, 'docs/08-thi-cong/tickets/HB-001-ton-phong.md'), ticketText());
    await git('init', '-q', '-b', 'main');
    await git('add', '.');
    await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
    await git('switch', '-q', '-c', 'ticket/HB-001-ton-phong');

    await writeFile(join(repo, 'apps/operations-web/src/page.tsx'), 'export {};\n');
    assert.match((await cli('ticket/HB-001-ton-phong')).stdout, /trong phạm vi/);

    // Tự thêm glob vào ticket trên nhánh: vẫn dùng bản trên main → cả hai file bị chặn.
    await writeFile(join(repo, 'docs/08-thi-cong/tickets/HB-001-ton-phong.md'), ticketText().replace('allow:\n', 'allow:\n  - apps/customer-web/**\n'));
    await mkdir(join(repo, 'apps/customer-web'), { recursive: true });
    await writeFile(join(repo, 'apps/customer-web/x.ts'), 'x\n');
    const failed = await cli('ticket/HB-001-ton-phong').then(() => undefined, (error) => error);
    assert.ok(failed, 'phải thất bại');
    assert.match(failed.stderr, /apps\/customer-web\/x\.ts: ngoài phạm vi/);
    assert.match(failed.stderr, /HB-001-ton-phong\.md: file được bảo vệ/);

    await assert.rejects(cli('ticket/HB-002-chua-co'), /chưa có đặc tả/);
    assert.match((await cli('lead/khac')).stdout, /bỏ qua/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
