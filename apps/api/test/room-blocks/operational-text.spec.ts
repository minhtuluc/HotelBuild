import { expect, test } from 'vitest';
import { maskOperationalText } from '../../src/modules/prop/room-blocks/operational-text.js';
for (const [input, want] of [
  ['CCCD012345678934', 'CCCD****8934'],
  ['tel0900000034', 'tel****0034'],
  ['contact: +84 (900) 000-034', 'contact: ****0034'],
  ['email: synthetic@example.test', 'email: ****test'],
  ['Repair until 2026-11-04, room 301', 'Repair until 2026-11-04, room 301'],
] as const)
  test(`operational text masks recognized identifiers: ${input}`, () => {
    expect(maskOperationalText(input)).toBe(want);
    expect(maskOperationalText(want)).toBe(want);
  });
