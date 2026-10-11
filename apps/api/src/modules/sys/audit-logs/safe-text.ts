import { maskTaskText } from '../../fo/housekeeping/task-text.js';
/** Labels are conservative; unlabelled arbitrary personal names cannot be inferred from free text. */
export function safeAuditText(value: string): string {
  return maskTaskText(
    value.replace(
      /((?:\b(?:access[ _-]*token|refresh[ _-]*token|pin[ _-]*token|api[ _-]*key|password(?:[ _-]*hash)?|authorization|secret))\s*[:#=]\s*)([^;\r\n,]+)/giu,
      (_match: string, label: string) => `${label}[REDACTED]`,
    ),
  );
}

export function secretSettingKey(key: string): boolean {
  return /(?:password|secret|token|authorization|api[._-]?key)/i.test(key);
}
