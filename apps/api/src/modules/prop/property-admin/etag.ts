import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { map } from 'rxjs';
@Injectable()
export class PropertyETag implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      map((value: unknown) => {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('version' in value) ||
          typeof value.version !== 'number' ||
          !Number.isSafeInteger(value.version)
        )
          throw new Error('PROP_RESPONSE_VERSION_INVALID');
        reply
          .header('ETag', '"' + value.version + '"')
          .header('Access-Control-Expose-Headers', 'ETag');
        return value;
      }),
    );
  }
}
