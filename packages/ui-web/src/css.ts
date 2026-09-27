/**
 * Sinh biến CSS từ token để web không chép lại giá trị màu (§7). Một nguồn chân lý duy nhất là tokens.ts.
 */
import { color, radius, space, touchTargetPx, typography } from './tokens.js';

function declarations(record: Readonly<Record<string, string | number>>, prefix: string): string[] {
  return Object.entries(record).map(([key, value]) => `  --${prefix}${key}: ${value};`);
}

/** Khối `:root { … }` dùng trong layout của hai web app. */
export function tokensToCssVariables(): string {
  const lines = [
    ...declarations(color, 'color-'),
    ...declarations(space, 'space-'),
    ...declarations(radius, 'radius-'),
    ...Object.entries(typography).map(([key, token]) => `  --text-${key}: ${token.web};`),
    `  --touch-target: ${touchTargetPx}px;`,
  ];
  return `:root {\n${lines.join('\n')}\n}\n`;
}
