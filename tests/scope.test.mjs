import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('phạm vi (QĐ-04): file khoá và file bảo vệ chặn; ngoài allow và vượt max_lines chỉ cảnh báo; unlock mở đúng file', () => {
  const ticket = parseTicket(ticketText('max_lines: 50\nunlock:\n  - packages/contracts/openapi.baseline.json\n'));
  const change = (path, added = 1) => ({ path, added, deleted: 0 });
  const clean = evaluateScope({ ticket, changes: [change('apps/operations-web/src/a.tsx'), change('pnpm-lock.yaml', 999)] });
  assert.deepEqual([clean.errors, clean.warnings], [[], []]);
  assert.equal(evaluateScope({ ticket, changes: [change('apps/api/prisma/schema.prisma', 999)] }).lines, 0, 'schema.prisma sinh tự động không tính vào max_lines');
  const { errors, warnings } = evaluateScope({ ticket, changes: [
    change('apps/customer-web/src/a.tsx'),
    change('apps/operations-web/test/locked.spec.ts'),
    change('docs/08-thi-cong/tickets/HB-001-x.md'),
    change('packages/contracts/openapi.baseline.json'),
    change('package.json'),
    change('docs/04-thiet-ke/api.md'),
    change('apps/operations-web/src/big.tsx', 60),
  ] });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /file khoá/);
  assert.match(errors[1], /HB-001-x\.md: file được bảo vệ/);
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /customer-web\/src\/a\.tsx: ngoài allow/);
  assert.match(warnings[1], /^package\.json: ngoài allow/);
  assert.match(warnings[2], /api\.md: ngoài allow/);
  assert.match(warnings[3], /max_lines 50/);
  const own = evaluateScope({ ticket, changes: [change('docs/08-thi-cong/tickets/HB-001-x.md')], ownTicketPath: 'docs/08-thi-cong/tickets/HB-001-x.md' });
  assert.deepEqual(own.errors, [], 'đặc tả tự soạn của chính ticket được tạo');
});

test('numstat: file nhị phân tính 0 dòng, giữ đường dẫn có tab/dấu cách', () => {
  assert.deepEqual(parseNumstat('3\t1\ta b.ts\n-\t-\tlogo.png\n'), [
    { path: 'a b.ts', added: 3, deleted: 1 }, { path: 'logo.png', added: 0, deleted: 0 }]);
});

test('CLI: ticket đọc từ main không nới được; ticket mới được tự soạn trên nhánh', async () => {
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
    assert.match((await cli('ticket/HB-001-ton-phong')).stdout, /— đạt\n/);

    // Tự nới ticket đã có trên main: ticket vẫn đọc từ main, sửa file ticket bị chặn; file ngoài allow chỉ cảnh báo.
    await writeFile(join(repo, 'docs/08-thi-cong/tickets/HB-001-ton-phong.md'), ticketText().replace('allow:\n', 'allow:\n  - apps/customer-web/**\n'));
    await mkdir(join(repo, 'apps/customer-web'), { recursive: true });
    await writeFile(join(repo, 'apps/customer-web/x.ts'), 'x\n');
    const failed = await cli('ticket/HB-001-ton-phong').then(() => undefined, (error) => error);
    assert.ok(failed, 'phải thất bại');
    assert.match(failed.stderr, /HB-001-ton-phong\.md: file được bảo vệ/);
    assert.match(failed.stderr, /apps\/customer-web\/x\.ts: ngoài allow/);

    // Ticket chưa có trên main: không có đặc tả → chặn kèm hướng dẫn; tự soạn trên nhánh → đạt có cảnh báo.
    await git('checkout', '-q', '--', '.');
    await rm(join(repo, 'apps/customer-web'), { recursive: true, force: true });
    await git('switch', '-q', '-c', 'ticket/HB-002-moi', 'main');
    await assert.rejects(cli('ticket/HB-002-moi'), /tự soạn/);
    await writeFile(join(repo, 'docs/08-thi-cong/tickets/HB-002-moi.md'), ticketText().replace('id: HB-001', 'id: HB-002'));
    await writeFile(join(repo, 'apps/operations-web/src/b.tsx'), 'export {};\n');
    const self = await cli('ticket/HB-002-moi');
    assert.match(self.stdout, /đạt \(có cảnh báo\)/);
    assert.match(self.stderr, /đặc tả tự soạn/);

    // A worker cannot self-publish a digest by introducing a new ticket.
    await writeFile(join(repo, 'docs/08-thi-cong/tickets/HB-002-moi.md'),
      ticketText(`locked_sha:\n  - ${'0'.repeat(64)} apps/operations-web/test/locked.spec.ts\n`).replace('id: HB-001', 'id: HB-002'));
    await assert.rejects(cli('ticket/HB-002-moi'), /locked_sha phải do lead/);

    assert.match((await cli('lead/khac')).stdout, /bỏ qua/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});


test('locked digest allows only exact pinned bytes; legacy locks remain hard', () => {
  const path = 'apps/operations-web/test/locked.spec.ts';
  const sha = createHash('sha256').update('immutable\n').digest('hex');
  const ticket = parseTicket(ticketText(`locked_sha:\n  - ${sha} ${path}\n`));
  const change = { path, added: 1, deleted: 0, contentSha256: sha };
  assert.deepEqual(evaluateScope({ ticket, changes: [change] }).errors, []);
  assert.equal(evaluateScope({ ticket, changes: [] }).errors.length, 1, 'missing pinned file is rejected even with no diff');
  assert.deepEqual(evaluateScope({ ticket, changes: [], lockedContentHashes: { [path]: sha } }).errors, []);
  for (const contentSha256 of [undefined, '0'.repeat(64)])
    assert.equal(evaluateScope({ ticket, changes: [{ ...change, contentSha256 }] }).errors.length, 1);
  assert.equal(evaluateScope({ ticket: parseTicket(ticketText()), changes: [change] }).errors.length, 1);
  for (const item of [`bad ${path}`, `${sha} unlisted.spec.ts`, `${sha} ${path}\n  - ${sha} ${path}`])
    assert.throws(() => parseTicket(ticketText(`locked_sha:\n  - ${item}\n`)), /locked_sha/);
});

test('manifest rejects scalar/duplicate keys and never treats inherited object properties as pins', () => {
  const sha = '0'.repeat(64);
  const broadLock = ticketText().replace('  - apps/operations-web/test/locked.spec.ts', '  - **');
  for (const path of ['__proto__', 'constructor', 'toString'])
    assert.equal(evaluateScope({ ticket: parseTicket(broadLock), changes: [{ path, added: 1, deleted: 0 }] }).errors.length, 1);
  const pinned = parseTicket(broadLock.replace('---\n\n#', `locked_sha:\n  - ${sha} __proto__\n---\n\n#`));
  assert.equal(Object.hasOwn(pinned.lockedDigests, '__proto__'), true);
  assert.equal(evaluateScope({ ticket: pinned, changes: [] }).errors.length, 1);
  assert.throws(() => parseTicket(ticketText(`locked_sha: ${sha} apps/operations-web/test/locked.spec.ts\n`)), /locked_sha/);
  assert.throws(() => parseTicket(ticketText(`locked_sha:\n  - ${sha} apps/operations-web/test/locked.spec.ts\nlocked_sha:\n`)), /trùng|duplicate/);
});

test('CLI pins base manifest for A+B, rejects changed/deleted/symlinked locked file and branch edits', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'scope-digest-'));
  const path = 'apps/operations-web/test/locked.spec.ts';
  const ticketPath = 'docs/08-thi-cong/tickets/HB-001-ton-phong.md';
  const content = 'immutable\n';
  const sha = createHash('sha256').update(content).digest('hex');
  const git = (...args) => run('git', args, { cwd: repo });
  const cli = () => run(process.execPath, ['scripts/check-scope.mjs'], { cwd: repo, env: { ...process.env, SCOPE_BASE: 'main', SCOPE_BRANCH: 'ticket/HB-001-ton-phong', GITHUB_HEAD_REF: '' } });
  try {
    for (const dir of ['scripts/lib', 'docs/08-thi-cong/tickets', 'apps/operations-web/test']) await mkdir(join(repo, dir), { recursive: true });
    for (const file of ['scripts/check-scope.mjs', 'scripts/lib/scope.mjs'])
      await copyFile(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(repo, file));
    await writeFile(join(repo, ticketPath), ticketText(`locked_sha:\n  - ${sha} ${path}\n`));
    await git('init', '-q', '-b', 'main');
    await git('add', '.');
    await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'lead pins manifest');
    await git('switch', '-q', '-c', 'ticket/HB-001-ton-phong');
    await writeFile(join(repo, path), content);
    assert.match((await cli()).stdout, /— đạt/);
    await git('add', path);
    await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'A locked file');
    assert.match((await cli()).stdout, /— đạt/);
    await writeFile(join(repo, path), 'tampered\n');
    await assert.rejects(cli(), /file khoá/);
    await rm(join(repo, path));
    await assert.rejects(cli(), /file khoá/);
    const { symlink } = await import('node:fs/promises');
    await writeFile(join(repo, 'immutable.txt'), content);
    await symlink('../../../immutable.txt', join(repo, path));
    await assert.rejects(cli(), /file khoá/);
    await rm(join(repo, path));
    await writeFile(join(repo, path), 'tampered\n');
    const evil = createHash('sha256').update('tampered\n').digest('hex');
    await writeFile(join(repo, ticketPath), ticketText(`locked_sha:\n  - ${evil} ${path}\n`));
    await assert.rejects(cli(), /file khoá/);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('CLI rejects a pinned file reached through a parent directory symlink even without a diff', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'scope-parent-link-'));
  const path = 'apps/operations-web/test/locked.spec.ts';
  const content = 'immutable\n';
  const sha = createHash('sha256').update(content).digest('hex');
  const git = (...args) => run('git', args, { cwd: repo });
  try {
    for (const dir of ['scripts/lib', 'docs/08-thi-cong/tickets', 'apps/operations-web', 'target-tests'])
      await mkdir(join(repo, dir), { recursive: true });
    for (const file of ['scripts/check-scope.mjs', 'scripts/lib/scope.mjs'])
      await copyFile(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(repo, file));
    await writeFile(join(repo, 'docs/08-thi-cong/tickets/HB-001-ton-phong.md'), ticketText(`locked_sha:\n  - ${sha} ${path}\n`));
    await writeFile(join(repo, 'target-tests/locked.spec.ts'), content);
    const { symlink } = await import('node:fs/promises');
    await symlink('../../target-tests', join(repo, 'apps/operations-web/test'));
    await git('init', '-q', '-b', 'main');
    await git('add', '.');
    await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'pinned parent symlink');
    await git('switch', '-q', '-c', 'ticket/HB-001-ton-phong');
    await assert.rejects(run(process.execPath, ['scripts/check-scope.mjs'], {
      cwd: repo, env: { ...process.env, SCOPE_BASE: 'main', SCOPE_BRANCH: 'ticket/HB-001-ton-phong', GITHUB_HEAD_REF: '' },
    }), /file khoá/);
  } finally { await rm(repo, { recursive: true, force: true }); }
});
