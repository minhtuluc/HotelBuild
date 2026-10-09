import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { userRoleSchema } from '@pinehill/contracts';
import { PermissionContribution } from './permissions.js';

@Injectable()
export class PermissionRegistry implements OnModuleInit {
  private readonly permissions = new Map<string, ReadonlySet<string>>();
  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    this.permissions.clear();
    for (const { instance } of this.discovery.getProviders()) {
      if (!(instance instanceof PermissionContribution)) continue;
      if (!instance.moduleName.trim()) throw new Error('Permission module name is empty');
      for (const [name, roles] of Object.entries(instance.rules)) {
        if (!/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/.test(name) || roles.length === 0) {
          throw new Error(`Invalid permission declaration in ${instance.moduleName}`);
        }
        if (this.permissions.has(name)) throw new Error(`Duplicate permission: ${name}`);
        if (roles.some((role) => !userRoleSchema.safeParse(role).success))
          throw new Error(`Invalid permission role: ${name}`);
        this.permissions.set(name, new Set(roles));
      }
    }
  }
  has(permission: string): boolean {
    return this.permissions.has(permission);
  }
  allows(role: string, permission: string): boolean {
    return this.permissions.get(permission)?.has(role) === true;
  }
}
