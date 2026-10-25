/**
 * Phiên khách (HB-017; QĐ-03 T2/T10): cùng bảng `auth_sessions`, cùng token refresh, cùng chữ ký access
 * token và cùng khoá family như nhân viên (HB-013), nhưng chủ thể là `guest_id` (`principal_type = GUEST`).
 * Không có idle 15 phút (quyết định 2): phiên sống 7 ngày kể từ lần đăng nhập, xoay refresh giữ nguyên hạn.
 */
import type { Prisma } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { invalidCredentials } from '../../../common/guards/auth.guard.js';
import type { ApiConfig } from '../../../config/env.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  signAccessToken,
} from '../../../infrastructure/crypto/access-tokens.js';
import {
  REFRESH_TOKEN_TTL_SECONDS,
  createRefreshToken,
  hashRefreshToken,
} from '../../../infrastructure/crypto/refresh-tokens.js';
import type { DatabaseClient } from '../../../infrastructure/prisma/prisma.module.js';
import { lockFamily } from '../auth-sessions.js';
import type { TokenPairResponse } from '../auth.service.js';
import type { GuestSurface } from './validation.js';

type Tx = Prisma.TransactionClient;

export interface GuestSessionRow {
  readonly id: string;
  readonly expires_at: Date;
}

export class GuestSessions {
  constructor(
    private readonly config: ApiConfig,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly prisma: DatabaseClient,
  ) {}

  /** Tạo phiên đầu của một family trong transaction của người gọi (đăng ký/đăng nhập). */
  async open(
    tx: Tx,
    guestId: string,
    surface: GuestSurface,
    ip: string | null,
    now: Date,
  ): Promise<{ session: GuestSessionRow; refreshToken: string }> {
    const refreshToken = createRefreshToken();
    const session = await tx.auth_sessions.create({
      data: {
        id: this.ids.generate(),
        principal_type: 'GUEST',
        guest_id: guestId,
        surface,
        family_id: this.ids.generate(),
        token_hash: hashRefreshToken(refreshToken),
        created_at: now,
        expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
        last_seen_at: now,
        ip,
      },
    });
    return { session, refreshToken };
  }

  async pair(
    session: GuestSessionRow,
    guestId: string,
    refreshToken: string,
    now: Date,
  ): Promise<TokenPairResponse> {
    const { token } = await signAccessToken(
      { userId: guestId, role: 'GUEST', propertyScope: [], sessionId: session.id },
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
      mustChangePassword: false,
    };
  }

  /**
   * Xoay refresh của khách. Token của nhân viên (`principal_type = USER`) hay token lạ đều bị từ chối
   * **trước** mọi thay đổi để một bên không thu hồi được phiên của bên kia. Reuse token đã xoay thu hồi cả family.
   */
  async refresh(refreshToken: string): Promise<TokenPairResponse> {
    const initial = await this.prisma.auth_sessions.findUnique({
      where: { token_hash: hashRefreshToken(refreshToken) },
    });
    if (initial === null || initial.principal_type !== 'GUEST') throw invalidCredentials();
    const nextToken = createRefreshToken();
    const result = await this.prisma.$transaction(async (tx) => {
      await lockFamily(tx, initial.family_id);
      const now = this.clock.now();
      // Điều kiện hợp lệ phải đọc lại SAU khi giữ khoá family: refresh/logout khác có thể đã commit.
      const session = await tx.auth_sessions.findUnique({
        where: { id: initial.id },
        include: { guests: true },
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
        return null; // commit việc thu hồi rồi mới trả 401 ngoài transaction
      }
      const guest = session.guests;
      if (guest === null || guest.anonymized_at !== null) return null;
      await tx.auth_sessions.update({
        where: { id: session.id },
        data: { rotated_at: now, last_seen_at: now },
      });
      const created = await tx.auth_sessions.create({
        data: {
          id: this.ids.generate(),
          principal_type: 'GUEST',
          guest_id: guest.id,
          surface: session.surface,
          family_id: session.family_id,
          token_hash: hashRefreshToken(nextToken),
          created_at: now,
          expires_at: session.expires_at,
          last_seen_at: now,
          ip: session.ip,
        },
      });
      return { session: created, guestId: guest.id, now };
    });
    if (result === null) throw invalidCredentials();
    return this.pair(result.session, result.guestId, nextToken, result.now);
  }
}
