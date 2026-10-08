/**
 * Access token JWT HS256 bằng `jose` (QĐ-03 quyết định 3; ADR-010): `exp` 15 phút, claims theo
 * `accessTokenClaimsSchema` của hợp đồng, kèm `sid` (phiên) để thu hồi tức thời khi logout/replay.
 */
import { SignJWT, jwtVerify } from 'jose';
import type { AccessTokenClaims } from '@pinehill/contracts';

/** Access token sống 15 phút (ADR-010) — dùng chung cho ký và cho `expiresInSeconds` của hợp đồng. */
export const ACCESS_TOKEN_TTL_SECONDS = 900;

export interface AccessTokenInput {
  readonly userId: string;
  readonly role: AccessTokenClaims['role'];
  readonly propertyScope: readonly string[];
  readonly sessionId: string;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  input: AccessTokenInput,
  secret: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const token = await new SignJWT({
    userId: input.userId,
    role: input.role,
    propertyScope: [...input.propertyScope],
    expiresAt: expiresAt.toISOString(),
    sid: input.sessionId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey(secret));
  return { token, expiresAt };
}

export interface VerifiedAccessToken {
  readonly userId: string;
  readonly role: string;
  readonly sessionId: string;
}

/** Xác thực chữ ký + `exp`; sai/hết hạn trả `null` (không ném để guard tự quyết định mã lỗi). */
export async function verifyAccessToken(
  token: string,
  secret: string,
  now: Date,
): Promise<VerifiedAccessToken | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: ['HS256'],
      // Kiểm exp theo Clock tiêm (test đóng băng thời gian), không theo đồng hồ hệ thống.
      currentDate: now,
    });
    const userId = payload['userId'];
    const role = payload['role'];
    const sessionId = payload['sid'];
    if (typeof userId !== 'string' || typeof role !== 'string' || typeof sessionId !== 'string') {
      return null;
    }
    return { userId, role, sessionId };
  } catch {
    return null;
  }
}
