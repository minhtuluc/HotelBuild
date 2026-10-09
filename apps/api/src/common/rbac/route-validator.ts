import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PUBLIC_ROUTE_KEY } from '../guards/decorators.js';
import { PermissionRegistry } from './permission-registry.js';
import { PERMISSION_KEY } from './permissions.js';

@Injectable()
export class RoutePermissionValidator implements OnApplicationBootstrap {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PermissionRegistry) private readonly permissions: PermissionRegistry,
  ) {}
  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype;
      if (!controller) continue;
      const prototype: unknown = controller.prototype;
      if (typeof prototype !== 'object' || prototype === null)
        throw new Error('Invalid permission controller');
      for (const method of this.scanner.getAllMethodNames(prototype))
        this.validate(controller, prototype, method);
    }
  }
  private validate(controller: Function, prototype: object, method: string): void {
    const handler: unknown = Reflect.get(prototype, method);
    if (
      typeof handler !== 'function' ||
      Reflect.getMetadata(METHOD_METADATA, handler) === undefined
    )
      return;
    const targets = [handler, controller];
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, targets) === true;
    const permission = this.reflector.getAllAndOverride<unknown>(PERMISSION_KEY, targets);
    if (isPublic && permission === undefined) return;
    if (isPublic || typeof permission !== 'string' || !this.permissions.has(permission)) {
      throw new Error(`Invalid or missing permission: ${controller.name}.${method}`);
    }
  }
}
