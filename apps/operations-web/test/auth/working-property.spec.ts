import { expect, test } from 'vitest';
import {
  WORKING_PROPERTY_KEY,
  clearStoredProperty,
  readStoredProperty,
  resolveWorkingProperty,
  storeProperty,
  type PropertyStorage,
} from '../../src/session/working-property';

function memory(
  initial: Record<string, string> = {},
): PropertyStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

test('one-property staff go straight in without a choice', () => {
  expect(resolveWorkingProperty({ choices: ['p1'], stored: null })).toEqual({
    kind: 'auto',
    propertyId: 'p1',
  });
});

test('several properties require a choice unless a valid one was stored for this tab session', () => {
  expect(resolveWorkingProperty({ choices: ['p1', 'p2'], stored: null })).toEqual({
    kind: 'choose',
  });
  expect(resolveWorkingProperty({ choices: ['p1', 'p2'], stored: 'p2' })).toEqual({
    kind: 'restored',
    propertyId: 'p2',
  });
});

test('a stored property outside the granted list is ignored (scope changed or other user)', () => {
  expect(resolveWorkingProperty({ choices: ['p1', 'p2'], stored: 'p9' })).toEqual({
    kind: 'choose',
  });
  expect(resolveWorkingProperty({ choices: ['p1'], stored: 'p9' })).toEqual({
    kind: 'auto',
    propertyId: 'p1',
  });
});

test('a single property is entered directly for every role, a stored choice among several is restored', () => {
  expect(resolveWorkingProperty({ choices: ['p1'], stored: null })).toEqual({
    kind: 'auto',
    propertyId: 'p1',
  });
  expect(resolveWorkingProperty({ choices: ['p1', 'p2'], stored: 'p1' })).toEqual({
    kind: 'restored',
    propertyId: 'p1',
  });
});

test('no granted property means "none" for everyone', () => {
  expect(resolveWorkingProperty({ choices: [], stored: null })).toEqual({
    kind: 'none',
  });
  expect(resolveWorkingProperty({ choices: [], stored: 'p1' })).toEqual({
    kind: 'none',
  });
});

test('storage helpers round-trip and survive a storage that throws', () => {
  const storage = memory();
  expect(readStoredProperty(storage)).toBeNull();
  storeProperty(storage, 'p1');
  expect(storage.data.get(WORKING_PROPERTY_KEY)).toBe('p1');
  expect(readStoredProperty(storage)).toBe('p1');
  clearStoredProperty(storage);
  expect(readStoredProperty(storage)).toBeNull();

  const broken: PropertyStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  expect(readStoredProperty(broken)).toBeNull();
  expect(() => storeProperty(broken, 'p1')).not.toThrow();
  expect(() => clearStoredProperty(broken)).not.toThrow();
  expect(readStoredProperty(undefined)).toBeNull();
});
