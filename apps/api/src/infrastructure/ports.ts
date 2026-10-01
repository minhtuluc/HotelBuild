/**
 * Cổng ra hạ tầng (kiến trúc §6: infrastructure/crypto-clocks).
 * Thời gian/ID lấy qua provider để kiểm thử được (không gọi `new Date()`/`randomUUID()` rải rác).
 */
import { randomUUID } from 'node:crypto';
import type { Clock, IdGenerator } from '@pinehill/domain';

export const CLOCK = Symbol('CLOCK');
export const ID_GENERATOR = Symbol('ID_GENERATOR');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class UuidGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}
