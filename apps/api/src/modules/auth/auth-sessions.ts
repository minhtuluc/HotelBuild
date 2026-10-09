import type { Prisma } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { userRoleSchema } from '@pinehill/contracts';
import type { ApiConfig } from '../../config/env.js';
import { invalidCredentials } from '../../common/guards/auth.guard.js';
import {
  signAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from '../../infrastructure/crypto/access-tokens.js';
import {
  createRefreshToken,
  hashRefreshToken,
} from '../../infrastructure/crypto/refresh-tokens.js';
import type { DatabaseClient } from '../../infrastructure/prisma/prisma.module.js';
import type { TokenPairResponse } from './auth.service.js';

/** Every family transition uses the same transaction lock, including descendant insertion. */
async function lockFamily(tx: Prisma.TransactionClient, familyId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`auth:family:${familyId}`}::text, 0))`;
}

export class AuthSessions {
  constructor(
    private readonly config: ApiConfig,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly prisma: DatabaseClient,
  ) {}

  async pair(
    session: { id: string; expires_at: Date },
    user: { id: string; role: string; must_change_password: boolean },
    refreshToken: string,
    now: Date,
  ): Promise<TokenPairResponse> {
    const scope = await this.prisma.user_property_scopes.findMany({ where: { user_id: user.id } });
    const { token } = await signAccessToken(
      {
        userId: user.id,
        role: userRoleSchema.parse(user.role),
        propertyScope: scope.map((row) => row.property_id),
        sessionId: session.id,
      },
      this.config.JWT_ACCESS_SECRET,
      now,
    );
    return {
      tokenType: 'Bearer',
      accessToken: token,
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshExpiresInSeconds: Math.max(
        0,
        Math.ceil((session.expires_at.getTime() - now.getTime()) / 1000),
      ),
      mustChangePassword: user.must_change_password,
    };
  }

  async refresh(refreshToken: string): Promise<TokenPairResponse> {
    const tokenHash = hashRefreshToken(refreshToken);
    const initial = await this.prisma.auth_sessions.findUnique({
      where: { token_hash: tokenHash },
    });
    if (initial === null) throw invalidCredentials();
    const nextToken = createRefreshToken();
    const result = await this.prisma.$transaction(async (tx) => {
      await lockFamily(tx, initial.family_id);
      const now = this.clock.now();
      // Eligibility must be read after the lock: another refresh/logout may have committed.
      const session = await tx.auth_sessions.findUnique({
        where: { id: initial.id },
        include: { users: true },
      });
      if (
        session === null ||
        session.revoked_at !== null ||
        session.expires_at.getTime() <= now.getTime()
      )
        return null;
      if (session.rotated_at !== null) {
        await tx.auth_sessions.updateMany({
          where: { family_id: session.family_id, revoked_at: null },
          data: { revoked_at: now, revoke_reason: 'REPLAY' },
        });
        return null; // Commit revocation before returning 401 outside the transaction.
      }
      if (
        session.surface === 'OPS_WEB' &&
        now.getTime() - session.last_seen_at.getTime() >= 15 * 60_000
      )
        return null;
      const user = session.users;
      if (user === null || !user.is_active) return null;
      await tx.auth_sessions.update({
        where: { id: session.id },
        data: { rotated_at: now, last_seen_at: now },
      });
      const created = await tx.auth_sessions.create({
        data: {
          id: this.ids.generate(),
          principal_type: 'USER',
          user_id: session.user_id,
          surface: session.surface,
          family_id: session.family_id,
          token_hash: hashRefreshToken(nextToken),
          expires_at: session.expires_at,
          last_seen_at: now,
          ip: session.ip,
        },
      });
      return { session: created, user, now };
    });
    if (result === null) throw invalidCredentials();
    return this.pair(result.session, result.user, nextToken, result.now);
  }

  async logout(sessionId: string): Promise<void> {
    const session = await this.prisma.auth_sessions.findUnique({ where: { id: sessionId } });
    if (session === null) throw invalidCredentials();
    await this.prisma.$transaction(async (tx) => {
      await lockFamily(tx, session.family_id);
      await tx.auth_sessions.updateMany({
        where: { family_id: session.family_id, revoked_at: null },
        data: { revoked_at: this.clock.now(), revoke_reason: 'LOGOUT' },
      });
    });
  }
}
