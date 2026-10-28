/**
 * HB-185 — ghi bằng chứng lượt quét vào `tests/e2e/a11y/last-run.json` và in bảng tổng kết.
 *
 * Playwright chạy song song nhiều worker/process nên không thể ghi đè một tệp duy nhất: mỗi màn ghi
 * một tệp riêng dưới `last-run/`, còn `last-run.json` được dựng lại dưới khoá thư mục (mkdir là thao
 * tác nguyên tử trên POSIX) để không worker nào đọc phải bản ghi dở.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKED_SCREENS, SCREENS, TOTAL_SCREENS } from './screens';

export const A11Y_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_DIR = path.join(A11Y_DIR, 'last-run');
const AGGREGATE = path.join(A11Y_DIR, 'last-run.json');
const LOCK = path.join(A11Y_DIR, '.last-run.lock');

export interface ObservedViolation {
  readonly rule: string;
  readonly impact: string;
  readonly nodes: number;
}

export interface ScreenResult {
  readonly id: string;
  readonly name: string;
  readonly surface: string;
  readonly path: string;
  /** `PASS` khi không có vi phạm serious/critical mới; `FAIL` khi có; `ERROR` khi màn không đạt trạng thái sẵn sàng. */
  readonly status: 'PASS' | 'FAIL' | 'ERROR';
  readonly violations: readonly ObservedViolation[];
  /** Vi phạm serious/critical không nằm trong baseline (rỗng ⇒ cổng xanh). */
  readonly newViolations: readonly ObservedViolation[];
  readonly durationMs: number;
  readonly error?: string;
}

interface Aggregate {
  readonly generatedAt: string;
  readonly totalScreens: number;
  readonly scanned: number;
  readonly blocked: number;
  readonly pass: number;
  readonly fail: number;
  readonly error: number;
  readonly screens: readonly ScreenResult[];
  readonly blockedScreens: readonly { id: string; surface: string; reason: string }[];
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function withLock<T>(action: () => Promise<T>): Promise<T> {
  let acquired = false;
  for (let attempt = 0; attempt < 400 && !acquired; attempt += 1) {
    try {
      await mkdir(LOCK);
      acquired = true;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
        await sleep(20);
        continue;
      }
      throw error;
    }
  }
  if (!acquired) throw new Error('Không giành được khoá ghi last-run.json');
  try {
    return await action();
  } finally {
    await rm(LOCK, { recursive: true, force: true });
  }
}

async function readRunDir(): Promise<ScreenResult[]> {
  let files: string[];
  try {
    files = await readdir(RUN_DIR);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const results: ScreenResult[] = [];
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const raw = await readFile(path.join(RUN_DIR, file), 'utf8');
    results.push(JSON.parse(raw) as ScreenResult);
  }
  return results;
}

function sortById(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id, 'en', { numeric: true });
}

function summarize(results: readonly ScreenResult[]): Aggregate {
  const byId = new Map(results.map((result) => [result.id, result]));
  const screens = [...byId.values()].sort(sortById);
  return {
    generatedAt: new Date().toISOString(),
    totalScreens: TOTAL_SCREENS,
    scanned: screens.length,
    blocked: BLOCKED_SCREENS.length,
    pass: screens.filter((screen) => screen.status === 'PASS').length,
    fail: screens.filter((screen) => screen.status === 'FAIL').length,
    error: screens.filter((screen) => screen.status === 'ERROR').length,
    screens,
    blockedScreens: BLOCKED_SCREENS.map((screen) => ({
      id: screen.id,
      surface: screen.surface,
      reason: screen.reason ?? 'không rõ',
    })),
  };
}

function summaryLine(aggregate: Aggregate): string {
  const known = aggregate.scanned + aggregate.blocked;
  const missing = aggregate.totalScreens - known;
  return [
    `[A11Y] TỔNG KẾT: ${aggregate.totalScreens} màn =`,
    `${aggregate.scanned} đã quét + ${aggregate.blocked} BLOCKED`,
    `= ${known}${missing === 0 ? '' : ` (+${missing} chưa ghi!)`}`,
    `· PASS ${aggregate.pass} · FAIL ${aggregate.fail} · ERROR ${aggregate.error}`,
  ].join(' ');
}

/** Ghi kết quả một màn rồi dựng lại `last-run.json` + in dòng tổng kết. */
export async function recordScreenResult(result: ScreenResult): Promise<void> {
  await mkdir(RUN_DIR, { recursive: true });
  await writeFile(path.join(RUN_DIR, `${result.id}.json`), JSON.stringify(result, null, 2));
  const aggregate = await withLock(async () => {
    const merged = summarize(await readRunDir());
    await writeFile(AGGREGATE, JSON.stringify(merged, null, 2));
    return merged;
  });
  const blocking = result.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  console.log(
    `[A11Y] ${result.id} ${result.surface} ${result.status} ` +
      `· serious/critical ${blocking.length} · mới ${result.newViolations.length} · ${result.durationMs}ms · ${result.path}`,
  );
  for (const violation of result.violations) {
    console.log(`[A11Y]   - ${violation.rule} (${violation.impact}, ${violation.nodes} node)`);
  }
  console.log(summaryLine(aggregate));
}

/** Bảng danh mục 83 màn in ra console — bằng chứng không màn nào biến mất. */
export function printCatalog(): void {
  for (const screen of SCREENS) {
    const detail = screen.status === 'scannable' ? `path=${screen.path}` : `BLOCKED: ${screen.reason ?? ''}`;
    console.log(`[A11Y] ${screen.id.padEnd(7)} ${screen.surface.padEnd(15)} ${screen.status.padEnd(9)} ${screen.name} — ${detail}`);
  }
  console.log(
    `[A11Y] DANH MỤC: ${SCREENS.length}/${TOTAL_SCREENS} màn · ` +
      `${SCREENS.filter((screen) => screen.status === 'scannable').length} quét được · ` +
      `${BLOCKED_SCREENS.length} BLOCKED`,
  );
}
