import { webEnv } from './index';

export function sessionConfig() {
  const configured = process.env.SESSION_APP_ORIGIN;
  if (configured && new URL(configured).origin !== configured) {
    throw new Error('SESSION_APP_ORIGIN must be an exact HTTP(S) origin');
  }
  if (configured && !['http:', 'https:'].includes(new URL(configured).protocol)) {
    throw new Error('SESSION_APP_ORIGIN must use HTTP(S)');
  }
  return {
    baseUrl: webEnv().NEXT_PUBLIC_API_BASE_URL,
    development: process.env.NODE_ENV === 'development',
    ...(configured ? { origin: configured } : {}),
  };
}
