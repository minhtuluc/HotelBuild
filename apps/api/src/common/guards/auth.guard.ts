/**
 * Guard xác thực toàn cục (BR-RBAC-05; QĐ-03 quyết định 3): **deny by default** — mọi route không có
 * `@Public()` đều cần bearer hợp lệ. Guard kiểm cả **trạng thái phiên trong CSDL** (đã thu hồi, hết hạn,
 * nhàn rỗi quá 15 phút với `OPS_WEB`) nên logout/replay vô hiệu access token ngay, không chỉ dựa chữ ký JWT.
 * `last_seen_at` chỉ cập nhật tối đa 1 lần/60 giây (QĐ-03 quyết định 9).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { AppError } from '../app-error.js';
import { resolveCorrelationId } from '../request-id.js';
import type { AuthenticatedActor } from '../actor/actor-context.js';
import { CONFIG } from '../../config/env.js';
import type { ApiConfig } from '../../config/env.js';
import { CLOCK, ID_GENERATOR } from '../../infrastructure/ports.js';
import { verifyAccessToken } from '../../infrastructure/crypto/access-tokens.js';
import { PRISMA } from '../../infrastructure/prisma/prisma.module.js';
import type { DatabaseClient } from '../../infrastructure/prisma/prisma.module.js';
import { PASSWORD_CHANGE_ALLOWED_KEY, PUBLIC_ROUTE_KEY } from './decorators.js';

/** Phiên operations web hết hạn sau 15 phút nhàn rỗi (TC-AUTH-02). */
export const IDLE_TIMEOUT_MS = 15 * 60_000;
/** Nhịp cập nhật `last_seen_at` tối thiểu (QĐ-03 quyết định 9). */
export const LAST_SEEN_THROTTLE_MS = 60_000;

export function invalidCredentials(): AppError {
  return new AppError(401, 'E_AUTH_INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu không đúng.');
}

/** Phiên khách (HB-017) hợp lệ nhưng không có quyền nào trên tuyến nhân viên. */
function guestSessionForbidden(): AppError {
  return new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
}

function passwordChangeRequired(): AppError {
  return new AppError(
    403,
    'E_AUTH_PASSWORD_CHANGE_REQUIRED',
    'Cần đổi mật khẩu trước khi tiếp tục.',
  );
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  return /^Bearer +(\S+)$/i.exec(header)?.[1] ?? null;
}

/** Phiên kèm người dùng (guard xác thực cần cả hai để kiểm trạng thái). */
type SessionWithUser = Prisma.auth_sessionsGetPayload<{ include: { users: true } }>;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(PRISMA) private readonly prisma: DatabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    request.actor = await this.authenticate(request, context);
    return true;
  }

  /** Xác thực bearer + trạng thái phiên/người dùng, trả actor đã kiểm để use case dùng lại. */
  private async authenticate(
    request: FastifyRequest,
    context: ExecutionContext,
  ): Promise<AuthenticatedActor> {
    const token = bearerToken(request.headers.authorization);
    if (token === null) throw invalidCredentials();
    const verified = await verifyAccessToken(
      token,
      this.config.JWT_ACCESS_SECRET,
      this.clock.now(),
    );
    if (verified === null) throw invalidCredentials();
    const session = await this.usableSession(verified.sessionId, verified.userId);
    const user = session?.users ?? null;
    if (user === null || !user.is_active) throw invalidCredentials();
    if (user.must_change_password && !this.passwordChangeAllowed(context)) {
      throw passwordChangeRequired();
    }
    return {
      id: user.id,
      role: user.role,
      ip: request.ip ?? null,
      correlationId: resolveCorrelationId(request.headers['x-correlation-id'], this.ids),
      sessionId: session.id,
      surface: session.surface,
      mustChangePassword: user.must_change_password,
    };
  }

  private passwordChangeAllowed(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_ALLOWED_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  /** Phiên còn dùng được: chưa thu hồi, đúng chủ, chưa hết hạn, chưa nhàn rỗi quá ngưỡng (web). */
  private async usableSession(sessionId: string, userId: string): Promise<SessionWithUser> {
    const session = await this.prisma.auth_sessions.findUnique({
      where: { id: sessionId },
      include: { users: true },
    });
    const now = this.clock.now();
    if (
      session === null ||
      session.revoked_at !== null ||
      (session.principal_type === 'GUEST' ? session.guest_id : session.user_id) !== userId ||
      session.expires_at.getTime() <= now.getTime()
    ) {
      throw invalidCredentials();
    }
    if (
      session.surface === 'OPS_WEB' &&
      now.getTime() - session.last_seen_at.getTime() >= IDLE_TIMEOUT_MS
    ) {
      throw invalidCredentials();
    }
    if (now.getTime() - session.last_seen_at.getTime() >= LAST_SEEN_THROTTLE_MS) {
      await this.prisma.auth_sessions.update({
        where: { id: session.id },
        data: { last_seen_at: now },
      });
    }
    // Phiên khách (HB-017) đã kiểm đủ (chưa thu hồi, đúng chủ, còn hạn) nhưng mọi tuyến có guard là tuyến nhân viên.
    if (session.principal_type === 'GUEST') throw guestSessionForbidden();
    return session;
  }
}
