#!/usr/bin/env node
/**
 * Merge PR an toàn khi repo chưa có branch protection (GitHub Free + repo private, xem sổ tay lead §4).
 *
 *   pnpm pr:merge <số-PR>
 *
 * Từ chối khi: PR nháp, có check chưa xong hoặc không SUCCESS, thiếu check bắt buộc, PR không merge được.
 * Merge squash + xoá nhánh, rồi chờ CI trên main và báo nếu đỏ.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REQUIRED_CHECKS = ['Quality gate (typecheck, lint, test, build)', 'docs-and-embedded', 'postgres16'];

/** Thuần để test: trả danh sách lý do từ chối (rỗng = được merge). */
export function mergeBlockers(pr, checks, required = REQUIRED_CHECKS) {
  const reasons = [];
  if (pr.isDraft) reasons.push('PR đang ở trạng thái nháp');
  if (pr.state !== 'OPEN') reasons.push(`PR không mở (state=${pr.state})`);
  if (pr.mergeable === 'CONFLICTING') reasons.push('PR xung đột với main — rebase trước');
  for (const name of required) {
    if (!checks.some((check) => check.name === name)) reasons.push(`thiếu check bắt buộc "${name}"`);
  }
  for (const check of checks) {
    if (check.state !== 'SUCCESS' && check.state !== 'SKIPPED') reasons.push(`check "${check.name}" = ${check.state}`);
  }
  return reasons;
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(number) {
  if (!/^\d+$/.test(number ?? '')) throw new Error('Dùng: pnpm pr:merge <số-PR>');
  const pr = JSON.parse(gh('pr', 'view', number, '--json', 'state,isDraft,mergeable,title,headRefName'));
  const checks = JSON.parse(gh('pr', 'checks', number, '--json', 'name,state'));
  const reasons = mergeBlockers(pr, checks);
  if (reasons.length) throw new Error(`Không merge PR #${number}:\n- ${reasons.join('\n- ')}`);
  // Không dùng --delete-branch: nhánh local thường đang mở trong worktree của agent → gh báo lỗi
  // dù đã merge, làm script dừng trước bước kiểm CI trên main. Chỉ xoá nhánh trên remote.
  gh('pr', 'merge', number, '--squash');
  try {
    gh('api', '-X', 'DELETE', `repos/{owner}/{repo}/git/refs/heads/${pr.headRefName}`);
  } catch {
    console.warn(`Không xoá được nhánh remote ${pr.headRefName} — xoá tay nếu cần`);
  }
  console.log(`Đã merge #${number}: ${pr.title}. Chờ CI trên main…`);
  const sha = gh('api', 'repos/{owner}/{repo}/commits/main', '--jq', '.sha').trim();
  for (let i = 0; i < 60; i++) {
    await sleep(20_000);
    const runs = JSON.parse(gh('run', 'list', '--commit', sha, '--json', 'name,status,conclusion'));
    if (runs.length && runs.every((run) => run.status === 'completed')) {
      const bad = runs.filter((run) => run.conclusion !== 'success');
      if (bad.length) throw new Error(`CI trên main ĐỎ sau merge (${sha.slice(0, 7)}): ${bad.map((run) => run.name).join(', ')} — sửa ngay`);
      console.log(`CI trên main xanh (${sha.slice(0, 7)}).`);
      return;
    }
  }
  throw new Error('Hết thời gian chờ CI trên main — kiểm tay bằng gh run list --branch main');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
