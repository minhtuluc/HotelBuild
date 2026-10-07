export interface PublicSession {
  accessToken: string;
  expiresInSeconds: number;
  mustChangePassword: boolean;
}
export interface SessionState extends PublicSession {
  expiresAt: number;
}
export function isPublicSession(value: unknown): value is PublicSession {
  if (!isRecord(value)) return false;
  return (
    typeof value.accessToken === 'string' &&
    value.accessToken.length >= 16 &&
    positiveSeconds(value.expiresInSeconds) &&
    typeof value.mustChangePassword === 'boolean'
  );
}
export function isSessionState(value: unknown): value is SessionState {
  return (
    isPublicSession(value) &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt)
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function positiveSeconds(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
