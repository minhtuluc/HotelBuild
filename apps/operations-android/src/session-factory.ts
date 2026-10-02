/** Lắp `Session` với phụ thuộc thật (secure store, NetInfo, env). */
import { randomUUID } from 'expo-crypto';
import { mobileEnv } from './config/index';
import { secureStorage } from './storage.native';
import { netInfoSource } from './netinfo.native';
import { Session } from './session';

export function createSession(): Session {
  return new Session({
    storage: secureStorage(),
    baseUrl: mobileEnv().EXPO_PUBLIC_API_BASE_URL,
    createId: () => randomUUID(),
    netInfo: netInfoSource(),
  });
}
