/** Actor `SYSTEM` của luồng tích hợp: không có `users.id` nào đại diện cho kênh (AC11). */
import type { ActorContext } from '../../../common/actor/actor-context.js';

export function systemActor(correlationId: string): ActorContext {
  return { id: null, role: 'SYSTEM', ip: null, correlationId };
}
