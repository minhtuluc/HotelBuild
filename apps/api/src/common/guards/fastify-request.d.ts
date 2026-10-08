import type { AuthenticatedActor } from '../actor/actor-context.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Actor do `AuthGuard` gắn sau khi xác thực; vắng mặt nghĩa là chưa xác thực. */
    actor?: AuthenticatedActor;
  }
}
