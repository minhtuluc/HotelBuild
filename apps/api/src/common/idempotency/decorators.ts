import { SetMetadata } from '@nestjs/common';
import type { ExecutionContext, Type } from '@nestjs/common';
import type { Principal } from './request.js';

export interface IdempotencyAccess {
  authorize(context: ExecutionContext): Promise<Principal>;
}
export const IDEMPOTENT = Symbol('IDEMPOTENT');
export const Idempotent = (access: Type<IdempotencyAccess>): MethodDecorator =>
  SetMetadata(IDEMPOTENT, access);
