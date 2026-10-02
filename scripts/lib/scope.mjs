/**
 * Phạm vi ticket (docs/08-thi-cong): hàm thuần để parse đặc tả ticket và đối chiếu diff.
 * Không I/O — CLI `scripts/check-scope.mjs` và vòng `agent-qc` cùng dùng.
 */

export const TICKET_ID = /\bHB-\d{3}\b/;
export const RISKS = ['R0', 'R1', 'R2'];
export const DEFAULT_MAX_LINES = 400;

/**
 * Hàng rào CỨNG (QĐ-04): sửa mà không có trong `unlock` thì cổng đỏ. Chỉ giữ những chỗ mà sửa nhầm
 * làm hỏng quản trị, hợp đồng đã phát hành, nguồn chân lý nghiệp vụ hoặc CI. Mọi file khác ngoài
 * `allow` chỉ bị CẢNH BÁO — người làm tự giải trình trong PR, lead xét ở bước cuối.
 */
export const PROTECTED = [
  'AGENTS.md',
  'docs/08-thi-cong/**',
  'docs/00-tong-quan.md',
  'docs/01-yeu-cau/**',
  'docs/02-nghiep-vu/**',
  'packages/contracts/openapi.baseline.json',
  'packages/config/**',
  '.github/**',
  '.omp/**',
  'scripts/check-scope.mjs',
  'scripts/lib/scope.mjs',
  'scripts/agent-qc/**',
];

/** Không tính vào giới hạn kích thước diff (sinh tự động). */
export const SIZE_EXEMPT = [
  'pnpm-lock.yaml',
  'packages/contracts/openapi.json',
  // Sinh bằng `prisma db pull`, CI kiểm không lệch với migration (QĐ-02 mục 2).
  'apps/api/prisma/schema.prisma',
];

export function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      // `**/` khớp 0..n thư mục; `**` ở cuối khớp mọi thứ còn lại.
      if (glob[i + 2] === '/') { source += '(?:.*/)?'; i += 2; } else { source += '.*'; i += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export const matchesAny = (file, globs) => globs.some((glob) => globToRegExp(glob).test(file));

/** Front matter tối giản: `key: value` và danh sách `key:` + dòng `  - item`. */
export function parseTicket(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) throw new Error('Ticket thiếu front matter (--- ... ---) ở đầu file');
  const fields = {};
  let listKey;
  for (const [index, raw] of match[1].split(/\r?\n/).entries()) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item) {
      if (!listKey) throw new Error(`Front matter dòng ${index + 2}: mục danh sách không thuộc khoá nào`);
      fields[listKey].push(item[1].trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    const pair = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`Front matter dòng ${index + 2}: không hiểu "${raw}"`);
    const [, key, value] = pair;
    if (value) { fields[key] = value.trim().replace(/^['"]|['"]$/g, ''); listKey = undefined; } else { fields[key] = []; listKey = key; }
  }
  return validateTicket(fields);
}

function validateTicket(fields) {
  const list = (key) => (Array.isArray(fields[key]) ? fields[key] : []);
  if (!TICKET_ID.test(fields.id ?? '') || fields.id.length !== 6) throw new Error(`Ticket id không hợp lệ: ${fields.id}`);
  if (!RISKS.includes(fields.risk)) throw new Error(`${fields.id}: risk phải là ${RISKS.join('/')}`);
  if (!list('allow').length) throw new Error(`${fields.id}: allow phải có ít nhất một glob`);
  const maxLines = fields.max_lines === undefined ? DEFAULT_MAX_LINES : Number(fields.max_lines);
  if (!Number.isInteger(maxLines) || maxLines < 1) throw new Error(`${fields.id}: max_lines không hợp lệ`);
  return { id: fields.id, title: fields.title ?? '', risk: fields.risk, owner: fields.owner ?? '',
    allow: list('allow'), locked: list('locked'), unlock: list('unlock'), maxLines };
}

export const ticketIdFromBranch = (branch) => /^ticket\/(HB-\d{3})(?:-|$)/.exec(branch ?? '')?.[1];

/** `true` khi vòng Codex QC phải chạy cho ticket này. */
export const needsCodexQc = (ticket) => ticket?.risk === 'R2';

/**
 * Lỗi (chặn): sửa file khoá của ticket, hoặc file trong `PROTECTED` mà không có trong `unlock`.
 * Cảnh báo (không chặn): file ngoài `allow`, diff vượt `max_lines` — giải trình trong PR (QĐ-04).
 * `ownTicketPath`: đặc tả do người làm tự soạn trên nhánh (ticket chưa có trên main) — được phép tạo.
 * @param {{ ticket: ReturnType<typeof parseTicket>, changes: { path: string, added: number, deleted: number }[], ownTicketPath?: string }} input
 * @returns {{ errors: string[], warnings: string[], lines: number }}
 */
export function evaluateScope({ ticket, changes, ownTicketPath }) {
  const errors = [];
  const warnings = [];
  let lines = 0;
  for (const { path, added, deleted } of changes) {
    if (!matchesAny(path, SIZE_EXEMPT)) lines += added + deleted;
    if (path === ownTicketPath) continue;
    if (matchesAny(path, ticket.locked)) errors.push(`${path}: file khoá của ${ticket.id} — không được sửa`);
    else if (matchesAny(path, PROTECTED) && !matchesAny(path, ticket.unlock)) errors.push(`${path}: file được bảo vệ — báo lead nếu thật sự cần sửa`);
    else if (!matchesAny(path, [...ticket.allow, ...ticket.unlock])) warnings.push(`${path}: ngoài allow của ${ticket.id} — ghi lý do vào mục "Ngoài phạm vi đã sửa" của PR`);
  }
  if (lines > ticket.maxLines) warnings.push(`Diff ${lines} dòng > max_lines ${ticket.maxLines} — ghi lý do vào PR (không chặn)`);
  return { errors, warnings, lines };
}

/** Parse `git diff --numstat` (file nhị phân hiện `-`, tính 0 dòng). */
export function parseNumstat(output) {
  return output.split('\n').filter(Boolean).map((row) => {
    const [added, deleted, ...rest] = row.split('\t');
    return { path: rest.join('\t'), added: Number(added) || 0, deleted: Number(deleted) || 0 };
  });
}
