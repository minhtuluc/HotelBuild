import { Children, isValidElement, type ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import PinSetupScreen from '../app/pin-setup';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';

// Only React hook runtime and native host bindings are replaced for the initial render.
// The actual screen, catalog, formatter and Session constructor execute.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => [initial, () => undefined],
}));
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
interface Props {
  children?: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
  secureTextEntry?: boolean;
  maxLength?: number;
  keyboardType?: string;
}
function inputs(node: ReactNode): Props[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Props>(child)) return [];
    return [...(child.type === 'TextInput' ? [child.props] : []), ...inputs(child.props.children)];
  });
}
test('localized PIN labels keep distinct fields and the original secure input attributes', () => {
  const session = new Session({
    baseUrl: 'https://synthetic.test/api/v1',
    storage: memoryStorage(),
    netInfo: { getConnected: async () => false },
    createId: () => '00000000-0000-4000-8000-000000000000',
    fetchImpl: async () => {
      throw Error('Rendering labels must not call the API');
    },
  });
  const fields = inputs(PinSetupScreen({ session, currentPassword: '', onDone: () => undefined }));
  expect(fields.map((field) => [field.testID, field.accessibilityLabel])).toEqual([
    ['pin-1', 'PIN lần 1'],
    ['pin-2', 'PIN lần 2'],
  ]);
  for (const field of fields) {
    expect(field.secureTextEntry).toBe(true);
    expect(field.maxLength).toBe(6);
    expect(field.keyboardType).toBe('number-pad');
  }
});
