import { Inject, Injectable, RequestMethod } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import {
  METHOD_METADATA,
  ROUTE_ARGS_METADATA,
  SSE_METADATA,
  REDIRECT_METADATA,
  RENDER_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { IDEMPOTENT } from './decorators.js';
@Injectable()
export class IdempotencyValidator implements OnApplicationBootstrap {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
  ) {}
  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype;
      if (!controller) continue;
      const prototype: unknown = controller.prototype;
      if (typeof prototype !== 'object' || prototype === null) continue;
      for (const method of this.scanner.getAllMethodNames(prototype))
        this.validate(controller, prototype, method);
    }
  }
  private validate(controller: Function, prototype: object, method: string): void {
    const handler: unknown = Reflect.get(prototype, method);
    if (typeof handler !== 'function' || !Reflect.hasMetadata(IDEMPOTENT, handler)) return;
    const access: unknown = Reflect.getMetadata(IDEMPOTENT, handler);
    const accessPrototype: unknown = typeof access === 'function' ? access.prototype : null;
    const registered = this.discovery.getProviders().some((provider) => provider.token === access);
    if (
      !registered ||
      typeof accessPrototype !== 'object' ||
      accessPrototype === null ||
      typeof Reflect.get(accessPrototype, 'authorize') !== 'function'
    )
      throw new Error('Idempotency requires a registered explicit authorizer');
    this.validateResponse(controller, handler, method);
  }
  private validateResponse(controller: Function, handler: Function, method: string): void {
    const verb: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
    if (
      ![RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE].some(
        (value) => value === verb,
      )
    )
      throw new Error('Idempotency requires a write method');
    const args: unknown = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method);
    const manualResponse =
      typeof args === 'object' &&
      args !== null &&
      Object.keys(args).some((key) => key.startsWith(`${RouteParamtypes.RESPONSE}:`));
    const transformed = [SSE_METADATA, REDIRECT_METADATA, RENDER_METADATA].some((key) =>
      Reflect.hasMetadata(key, handler),
    );
    if (manualResponse || transformed)
      throw new Error('Idempotency requires a returned JSON response');
  }
}
