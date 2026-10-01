import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { needsCodexQc, parseTicket, ticketIdFromBranch } from '../lib/scope.mjs';

const run = promisify(execFile);
const TICKET_DIR = join('docs', '08-thi-cong', 'tickets');

/**
 * Quyết định có gọi Codex hay không theo hạng rủi ro ticket của nhánh hiện tại.
 * `AGENT_QC=always|never` ghi đè (vd. lead muốn Codex soát một nhánh không phải ticket).
 */
export async function ticketGate({ repoDir, env = process.env }) {
  if (env.AGENT_QC === 'always') return { review: true, summary: 'AGENT_QC=always' };
  if (env.AGENT_QC === 'never') return { review: false, summary: 'AGENT_QC=never' };

  const { stdout } = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoDir });
  const branch = stdout.trim();
  const id = ticketIdFromBranch(branch);
  if (!id) return { review: false, summary: `Nhánh ${branch} không phải ticket/HB-nnn-*; bỏ qua Codex QC (đặt AGENT_QC=always để ép chạy)` };

  const file = (await readdir(join(repoDir, TICKET_DIR)).catch(() => [])).find((name) => name.startsWith(id) && name.endsWith('.md'));
  // Không đọc được hạng rủi ro thì coi như rủi ro cao: thà tốn một lượt review còn hơn lọt lỗi.
  if (!file) return { review: true, summary: `${id}: không thấy đặc tả ticket; chạy Codex QC cho an toàn` };
  let ticket;
  try {
    ticket = parseTicket(await readFile(join(repoDir, TICKET_DIR, file), 'utf8'));
  } catch (error) {
    return { review: true, summary: `${id}: đặc tả lỗi (${error.message}); chạy Codex QC cho an toàn` };
  }
  return needsCodexQc(ticket)
    ? { review: true, summary: `${id} hạng ${ticket.risk}: chạy Codex QC` }
    : { review: false, summary: `${id} hạng ${ticket.risk}: Codex QC chỉ dành cho R2; review qua Gemini ở PR` };
}
