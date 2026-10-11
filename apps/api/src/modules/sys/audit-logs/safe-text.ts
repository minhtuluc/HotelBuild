import { maskTaskText } from '../../fo/housekeeping/task-text.js';
/** Labels are conservative; unlabelled arbitrary personal names cannot be inferred from free text. */
export function safeAuditText(value: string, depth = 0): string {
  if (depth > 16) return '[REDACTED]';
  if (/^[\[{]/.test(value.trim())) {
    try {
      const parsed: unknown = JSON.parse(value);
      return JSON.stringify(structuredText(parsed, depth + 1));
    } catch {
      /* Non-JSON text still follows the explicit label mask below. */
    }
  }
  return maskTaskText(
    value.replace(
      /((?:\b(?:access[ _-]*token|refresh[ _-]*token|pin[ _-]*token|api[ _-]*key|password(?:[ _-]*hash)?|authorization|secret))["']?\s*[:#=]\s*["']?)([^;\r\n,]+)/giu,
      (_match: string, label: string) => `${label}[REDACTED]`,
    ),
  );
}
function structuredText(value: unknown, depth: number): unknown {
  if (depth > 16) return '[REDACTED]';
  if (typeof value === 'string') return safeAuditText(value, depth + 1);
  if (Array.isArray(value)) return value.map((part) => structuredText(part, depth + 1));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, part]) => [
      key,
      sensitiveLabel(key) ? '[REDACTED]' : structuredText(part, depth + 1),
    ]),
  );
}
function sensitiveLabel(key: string): boolean {
  return (
    secretSettingKey(key) ||
    ['phone', 'phonenumber', 'email', 'idnumber', 'passport', 'cccd', 'cmnd'].includes(
      key.toLowerCase().replaceAll(/[_ -]/g, ''),
    )
  );
}
export function secretSettingKey(key: string): boolean {
  return /(?:password|secret|token|authorization|api[._-]?key)/i.test(key);
}
