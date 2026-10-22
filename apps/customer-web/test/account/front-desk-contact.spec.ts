import { describe, expect, it } from 'vitest';
import { readFrontDeskContact } from '../../src/config/index';

describe('readFrontDeskContact', () => {
  it('trims a configured contact line', () => {
    expect(readFrontDeskContact('  Lễ tân: 0263 000 000 (7:00–22:00) ')).toBe(
      'Lễ tân: 0263 000 000 (7:00–22:00)',
    );
  });

  it.each([undefined, '', '   ', 'x'.repeat(161)])(
    'falls back to generic guidance for %j',
    (value) => {
      expect(readFrontDeskContact(value)).toBeNull();
    },
  );
});
