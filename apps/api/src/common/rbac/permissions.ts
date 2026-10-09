import { SetMetadata } from '@nestjs/common';
import type { Provider } from '@nestjs/common';

export const PERMISSION_KEY = 'pinehill.permission';
export const Permission = (name: string): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_KEY, name);
export type PermissionRules = Readonly<Record<string, readonly string[]>>;

/** A module owns its permission declarations; registration never requires editing a global role ladder. */
export class PermissionContribution {
  constructor(
    readonly moduleName: string,
    readonly rules: PermissionRules,
  ) {}
}
export function permissionProvider(moduleName: string, rules: PermissionRules): Provider {
  return {
    provide: Symbol(`permissions:${moduleName}`),
    useValue: new PermissionContribution(moduleName, rules),
  };
}
