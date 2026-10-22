#!/usr/bin/env node
/**
 * Cổng phát hành NFR-SEC-06 (HB-183): lỗ hổng CVSS ≥ 7,0 chưa xử lý quá 7 ngày thì chặn.
 *   node security-audit-gate.mjs <audit.json> [--waivers <file>] [--today YYYY-MM-DD] [--release]
 * Finding vào cổng khi CVSS ≥ 7,0, hoặc chưa có điểm CVSS mà registry xếp high/critical. Waiver chỉ
 * có hiệu lực 7 ngày kể từ firstSeen; reviewedAt không trước firstSeen và trong 7 ngày gần nhất;
 * `--release` bỏ qua waiver; thiếu "advisories" = fail closed. Chỉ in GHSA/package/phiên bản/điểm số.
 */
import { readFileSync } from 'node:fs';

const HORIZON_DAYS = 7;
const DAY_MS = 86_400_000;
const CVSS_FLOOR = 7;
const UNSCORED_BLOCKING = new Set(['high', 'critical']);
const DEFAULT_WAIVERS = new URL('./security-waivers.json', import.meta.url);

function fail(message) {
  console.error(`Cổng bảo mật: ${message}`);
  process.exit(2);
}

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { fail(`không đọc được ${label} (${error.code ?? error.message})`); }
}

/** Ngày `YYYY-MM-DD` -> mili giây UTC; null nếu không phải ngày lịch hợp lệ. */
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? null : ms;
}
function parseArgs(argv) {
  const options = { audit: '', waivers: '', release: false, today: new Date().toISOString().slice(0, 10) };
  const flags = new Map([
    ['--waivers', (value) => { options.waivers = value; }],
    ['--today', (value) => { options.today = value; }],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--release') options.release = true;
    else if (flags.has(arg)) flags.get(arg)(argv[(index += 1)] ?? '');
    else if (arg.startsWith('-')) fail(`tham số lạ ${arg}`);
    else if (options.audit) fail(`tham số thừa ${arg}`);
    else options.audit = arg;
  }
  if (!options.audit) fail('thiếu đường dẫn báo cáo `pnpm audit --json`');
  if (day(options.today) === null) fail('--today phải là ngày YYYY-MM-DD');
  options.waivers ||= DEFAULT_WAIVERS;
  return options;
}
function findingRows(audit) {
  return Object.values(audit.advisories ?? {})
    .map((advisory) => ({
      id: advisory.github_advisory_id,
      package: advisory.module_name,
      versions: [...new Set((advisory.findings ?? []).map((finding) => finding.version))],
      score: Number(advisory.cvss?.score) > 0 ? Number(advisory.cvss.score) : null,
      severity: advisory.severity,
    }))
    .filter((row) => (row.score === null ? UNSCORED_BLOCKING.has(row.severity) : row.score >= CVSS_FLOOR));
}

function describe(row) {
  const score = row.score === null ? `chưa có điểm CVSS (mức ${row.severity})` : `CVSS ${row.score}`;
  return `${row.id} ${row.package}@${row.versions.join(',')} — ${score}`;
}

function validateWaivers(waivers) {
  if (!Array.isArray(waivers)) fail('"waivers" phải là mảng');
  const seen = new Set();
  waivers.forEach((waiver, index) => {
    const label = `waiver #${index + 1}`;
    for (const field of ['github_advisory_id', 'package', 'owner', 'reason']) {
      if (typeof waiver[field] !== 'string' || !waiver[field].trim()) fail(`${label}: thiếu "${field}"`);
    }
    for (const field of ['firstSeen', 'reviewedAt']) {
      if (day(waiver[field]) === null) fail(`${label} (${waiver.github_advisory_id}): ${field} phải là YYYY-MM-DD`);
    }
    const key = `${waiver.github_advisory_id}|${waiver.package}`;
    if (seen.has(key)) fail(`${label}: trùng mục ${key}`);
    seen.add(key);
  });
}

function evaluate(rows, waivers, todayMs) {
  const blocks = [];
  for (const row of rows) {
    const label = describe(row);
    const waiver = waivers.find((item) => item.github_advisory_id === row.id && item.package === row.package);
    if (!waiver) { blocks.push(`${label}: chưa có waiver`); continue; }
    const first = day(waiver.firstSeen);
    const reviewed = day(waiver.reviewedAt);
    const age = Math.floor((todayMs - first) / DAY_MS);
    const reviewAge = Math.floor((todayMs - reviewed) / DAY_MS);
    if (first > todayMs) blocks.push(`${label}: firstSeen ở tương lai`);
    else if (age > HORIZON_DAYS) blocks.push(`${label}: phát hiện ${age} ngày trước (> ${HORIZON_DAYS})`);
    if (reviewed < first) blocks.push(`${label}: reviewedAt trước firstSeen`);
    else if (reviewAge > HORIZON_DAYS) blocks.push(`${label}: waiver rà soát ${reviewAge} ngày trước (> ${HORIZON_DAYS})`);
  }
  return blocks;
}
const options = parseArgs(process.argv.slice(2));
const audit = readJson(options.audit, 'báo cáo audit');
if (!audit || typeof audit.advisories !== 'object' || audit.advisories === null) {
  fail('báo cáo audit thiếu "advisories" (registry lỗi?) — không kết luận đạt');
}
const rows = findingRows(audit);
const source = options.release ? { waivers: [] } : readJson(options.waivers, 'file waiver');
const waivers = source.waivers ?? [];
validateWaivers(waivers);
const blocks = evaluate(rows, waivers, day(options.today));
process.stdout.write(`Cổng bảo mật: ${rows.length} finding CVSS ≥ ${CVSS_FLOOR}.0 hoặc high/critical chưa có điểm\n`);
rows.forEach((row) => process.stdout.write(`- ${describe(row)}\n`));
if (options.release) process.stdout.write('Chế độ phát hành: bỏ qua toàn bộ waiver.\n');
if (!blocks.length) {
  process.stdout.write('\nĐẠT: không còn finding quá hạn 7 ngày hoặc thiếu waiver.\n');
} else {
  process.stdout.write(`\nKHÔNG ĐẠT (${blocks.length} lỗi):\n${blocks.map((line) => `- ${line}`).join('\n')}\n`);
  process.exitCode = 1;
}
