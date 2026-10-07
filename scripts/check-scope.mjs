#!/usr/bin/env node
/**
 * Cổng phạm vi ticket. Trên nhánh `ticket/HB-nnn-*`, đặc tả ticket được đọc từ **nhánh nền**
 * (merge-base), nên người làm không thể tự nới phạm vi bằng cách sửa ticket trên nhánh của mình.
 *
 *   node scripts/check-scope.mjs                 # nhánh hiện tại so với origin/main
 *   SCOPE_BASE=main SCOPE_BRANCH=ticket/HB-001-x node scripts/check-scope.mjs
 *
 * Nhánh không phải ticket: in thông báo và thoát 0 (nhánh lead/* được duyệt qua PR).
 * Chặn: file khoá, file bảo vệ. Cảnh báo: ngoài allow, vượt max_lines, đặc tả tự soạn (QĐ-04).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateScope, parseNumstat, parseTicket, ticketIdFromBranch } from './lib/scope.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const TICKET_DIR = 'docs/08-thi-cong/tickets/';
const git = (...args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function fail(message) {
  console.error(`Scope: ${message}`);
  process.exit(1);
}

const branch = process.env.SCOPE_BRANCH || process.env.GITHUB_HEAD_REF || git('rev-parse', '--abbrev-ref', 'HEAD').trim();
const id = ticketIdFromBranch(branch);
if (!id) {
  console.log(`Scope: nhánh "${branch}" không phải ticket/HB-nnn-* — bỏ qua cổng phạm vi`);
  process.exit(0);
}

const base = process.env.SCOPE_BASE || 'origin/main';
let mergeBase;
try { mergeBase = git('merge-base', base, 'HEAD').trim(); } catch { fail(`không tìm được merge-base với ${base} (cần fetch đủ lịch sử)`); }

const findTicket = (treeish) => git('ls-tree', '-r', '--name-only', treeish, TICKET_DIR).split('\n').find((file) => file.startsWith(`${TICKET_DIR}${id}`));
let ticketPath = findTicket(mergeBase);
let ticketSource = ticketPath ? `${mergeBase}:${ticketPath}` : undefined;
let ownTicketPath;
if (!ticketPath) {
  // QĐ-04: người làm được tự soạn đặc tả từ dòng backlog khi lead chưa viết; lead duyệt ở bước cuối.
  ticketPath = findTicket('HEAD') ?? git('ls-files', '--others', '--exclude-standard', TICKET_DIR).split('\n').find((file) => file.startsWith(`${TICKET_DIR}${id}`));
  if (!ticketPath) fail(`${id} chưa có đặc tả — tự soạn \`${TICKET_DIR}${id}-<slug>.md\` từ dòng backlog (mẫu: tickets/_mau.md) trong chính nhánh này`);
  ownTicketPath = ticketPath;
}

let ticket;
try {
  ticket = parseTicket(ticketSource ? git('show', ticketSource) : readFileSync(join(root, ticketPath), 'utf8'));
} catch (error) { fail(`${ticketPath}: ${error.message}`); }
if (ticket.id !== id) fail(`${ticketPath}: id ${ticket.id} không khớp nhánh ${id}`);

if (ownTicketPath && Object.keys(ticket.lockedDigests).length)
  fail('locked_sha phải do lead công bố trong ticket trên nhánh nền, không tự ghim trên nhánh thi công');

// So với merge-base gồm cả working tree (chạy cục bộ) lẫn file chưa track.
const changes = parseNumstat(git('diff', '--numstat', '--no-renames', mergeBase));
for (const file of git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) {
  changes.push({ path: file, added: readFileSync(join(root, file), 'utf8').split('\n').length, deleted: 0 });
}

// Validate EVERY pinned file, even when removed additions disappear from the diff.
// Missing files and symlinks cannot satisfy an immutable locked-file digest.
const lockedContentHashes = Object.create(null);
for (const file of Object.keys(ticket.lockedDigests)) {
  const parts = file.split('/');
  let path = root;
  let regular = true;
  try {
    for (const [index, part] of parts.entries()) {
      path = join(path, part);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
        regular = false;
        break;
      }
    }
    if (regular) lockedContentHashes[file] = createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    // Unreadable/missing paths fail closed through the digest check below.
  }
}

const { errors, warnings, lines } = evaluateScope({ ticket, changes, ownTicketPath, lockedContentHashes });
const notes = [...(ownTicketPath ? [`${ownTicketPath}: đặc tả tự soạn — lead duyệt cùng PR`] : []), ...warnings];
if (notes.length) console.warn(`Scope: ${id} cảnh báo (không chặn)\n${notes.join('\n')}`);
if (errors.length) fail(`${id} (${ticket.risk}) ${errors.length} lỗi\n${errors.join('\n')}`);
console.log(`Scope: ${id} (${ticket.risk}) ${changes.length} file, ${lines}/${ticket.maxLines} dòng — đạt${notes.length ? ' (có cảnh báo)' : ''}`);
