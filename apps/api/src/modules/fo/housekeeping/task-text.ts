import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
/**
 * Notes are for cleaning instructions, never a guest document store. Mask known document labels
 * conservatively through the next field separator, including identifiers containing letters/spaces.
 * This is not a general PII classifier: names or unlabelled arbitrary documents cannot be inferred.
 */
export function maskTaskText(value: string): string {
  const labelled = value
    .normalize('NFC')
    .replace(
      /((?:\bpassport(?:[ _-]*(?:number|no\.?))?|\bid[ _-]*number|\bCCCD|\bCMND|hộ\s+chiếu|số\s+giấy\s+tờ)\s*[:#=]?\s*)([^;\r\n,]+)/giu,
      (_match: string, label: string, details: string) => {
        const identifier = details.trim();
        return `${label}****${identifier.length > 4 ? identifier.slice(-4) : ''}`;
      },
    );
  return maskOperationalText(labelled);
}
