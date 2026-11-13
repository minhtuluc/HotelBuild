/**
 * Sinh biến CSS từ token để web không chép lại giá trị màu (§7). Một nguồn chân lý duy nhất là tokens.ts.
 */
import { color, fontFamily, radius, space, worldInk, touchTargetPx, typography } from './tokens.js';

function declarations(record: Readonly<Record<string, string | number>>, prefix: string): string[] {
  return Object.entries(record).map(([key, value]) => `  --${prefix}${key}: ${value};`);
}

/** Khoảng cách và bán kính là độ dài: phải có đơn vị, nếu không `var(--space-s4, 16px)` mất hiệu lực. */
function lengthDeclarations(record: Readonly<Record<string, number>>, prefix: string): string[] {
  return Object.entries(record).map(([key, value]) => `  --${prefix}${key}: ${value}px;`);
}

/** Bí danh ngắn dùng trong CSS thành phần (globals.css) — tên theo thế giới vé tàu. */
function aliasDeclarations(): string[] {
  return [
    `  --paper: ${color.bg};`,
    `  --ink: ${color.text};`,
    `  --ink-soft: ${color.textMuted};`,
    `  --line: ${color.border};`,
    `  --board: ${color.dark};`,
    `  --print: ${color.primary};`,
    `  --punch: ${color.accent};`,
  ];
}

/** Khối `:root { … }` dùng trong layout của hai web app. */
export function tokensToCssVariables(): string {
  const lines = [
    ...declarations(color, 'color-'),
    ...declarations(worldInk, 'color-world-'),
    ...declarations(fontFamily, 'font-'),
    ...lengthDeclarations(space, 'space-'),
    ...lengthDeclarations(radius, 'radius-'),
    ...Object.entries(typography).map(([key, token]) => `  --text-${key}: ${token.web};`),
    `  --touch-target: ${touchTargetPx}px;`,
    ...aliasDeclarations(),
  ];
  return `:root {\n${lines.join('\n')}\n}\n`;
}
