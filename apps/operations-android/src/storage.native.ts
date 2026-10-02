/** Bản lưu trữ thật dùng Keychain/Keystore của hệ điều hành (expo-secure-store). */
import * as SecureStore from 'expo-secure-store';
import type { KeyValueStorage } from './storage';

export const secureStorage = (): KeyValueStorage => ({
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
});
