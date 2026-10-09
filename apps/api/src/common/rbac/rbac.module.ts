import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PermissionRegistry } from './permission-registry.js';
import { RoutePermissionValidator } from './route-validator.js';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [PermissionRegistry, RoutePermissionValidator],
  exports: [PermissionRegistry],
})
export class RbacModule {}
