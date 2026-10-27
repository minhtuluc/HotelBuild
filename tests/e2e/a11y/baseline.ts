/**
 * HB-185 — baseline vi phạm accessibility đã biết. Cổng chỉ đỏ khi xuất hiện vi phạm **mới** so với
 * danh sách này; không nới tiêu chí (vẫn serious/critical, vẫn đủ 4 tag WCAG 2.1 AA) và không tắt rule.
 *
 * Mỗi dòng: `{ "screen": "SCR-xx", "rule": "color-contrast", "impact": "serious", "nodes": 3 }`.
 * Khoá so khớp là `screen + rule` (số node chỉ để theo dõi xu hướng). Khi sửa xong lỗi, xoá dòng
 * tương ứng để baseline không che lỗi tái phát.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BaselineViolation {
  readonly screen: string;
  readonly rule: string;
  readonly impact: 'serious' | 'critical';
  readonly nodes: number;
  readonly note?: string;
}

interface BaselineFile {
  readonly note: string;
  readonly violations: readonly BaselineViolation[];
}

const BASELINE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'baseline.json');

export function loadBaseline(): BaselineFile {
  const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Partial<BaselineFile>;
  return { note: raw.note ?? '', violations: raw.violations ?? [] };
}

/** Khoá so khớp `SCR-xx:rule` — một rule lặp trên nhiều màn là hai dòng riêng. */
export function baselineKeys(file: BaselineFile): ReadonlySet<string> {
  return new Set(file.violations.map((violation) => `${violation.screen}:${violation.rule}`));
}
