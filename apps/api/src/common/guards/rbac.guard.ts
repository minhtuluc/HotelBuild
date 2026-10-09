import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { InjectPinoLogger } from 'nestjs-pino';
import { PRISMA } from '../../infrastructure/prisma/prisma.module.js';
import type { DatabaseClient } from '../../infrastructure/prisma/prisma.module.js';
import { authorizeActor } from '../actor/authorized-actor.js';
import { AppError } from '../app-error.js';
import { PermissionRegistry } from '../rbac/permission-registry.js';
import { PERMISSION_KEY } from '../rbac/permissions.js';
import { PUBLIC_ROUTE_KEY } from './decorators.js';
import { invalidCredentials } from './auth.guard.js';

interface DenialLogger {
  warn(context: Record<string, unknown>, message: string): void;
}
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PermissionRegistry) private readonly permissions: PermissionRegistry,
    @Inject(PRISMA) private readonly prisma: DatabaseClient,
    @InjectPinoLogger(RbacGuard.name) private readonly logger: DenialLogger,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, targets) === true) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authenticated = request.actor;
    if (!authenticated) throw invalidCredentials();
    const user = await this.prisma.users.findUnique({
      where: { id: authenticated.id },
      select: {
        role: true,
        is_active: true,
        user_property_scopes: { select: { property_id: true } },
      },
    });
    if (!user?.is_active) throw invalidCredentials();
    const actor = authorizeActor(
      { ...authenticated, role: user.role },
      user.user_property_scopes.map((scope) => scope.property_id),
      this.permissions,
    );
    request.actor = actor;
    const permission = this.reflector.getAllAndOverride<unknown>(PERMISSION_KEY, targets);
    if (typeof permission !== 'string' || !actor.hasPermission(permission)) {
      this.logger.warn(
        { event: 'RBAC_DENIED', reason: 'PERMISSION', correlationId: actor.correlationId },
        'Access denied',
      );
      throw new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
    }
    return true;
  }
}
