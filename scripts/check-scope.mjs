#!/usr/bin/env node
/**
 * Cổng phạm vi ticket. Trên nhánh `ticket/HB-nnn-*`, đặc tả ticket được đọc từ **nhánh nền**
 * (merge-base), nên người làm không thể tự nới phạm vi bằng cách sửa ticket trên nhánh của mình.
 *
 *   node scripts/check-scope.mjs                 # nhánh hiện tại so với origin/main
 *   SCOPE_BASE=main SCOPE_BRANCH=ticket/HB-001-x node scripts/check-scope.mjs
 *
 * Nhánh không phải ticket: in thông báo và thoát 0 (nhánh lead/* được duyệt qua PR).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

const ticketPath = git('ls-tree', '-r', '--name-only', mergeBase, TICKET_DIR).split('\n').find((file) => file.startsWith(`${TICKET_DIR}${id}`));
if (!ticketPath) fail(`${id} chưa có đặc tả trong ${TICKET_DIR} trên ${base} — lead phải merge ticket trước khi giao việc`);

let ticket;
try { ticket = parseTicket(git('show', `${mergeBase}:${ticketPath}`)); } catch (error) { fail(`${ticketPath}: ${error.message}`); }
if (ticket.id !== id) fail(`${ticketPath}: id ${ticket.id} không khớp nhánh ${id}`);

// So với merge-base gồm cả working tree (chạy cục bộ) lẫn file chưa track.
const changes = parseNumstat(git('diff', '--numstat', '--no-renames', mergeBase));
for (const file of git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) {
  changes.push({ path: file, added: readFileSync(join(root, file), 'utf8').split('\n').length, deleted: 0 });
}

const { errors, lines } = evaluateScope({ ticket, changes });
if (errors.length) fail(`${id} (${ticket.risk}) ${errors.length} lỗi\n${errors.join('\n')}`);
console.log(`Scope: ${id} (${ticket.risk}) ${changes.length} file, ${lines}/${ticket.maxLines} dòng — trong phạm vi`);
