import { createJourneyHandler } from '@pinehill/web-session/server';
import { ratePlanUpdateRequestSchema } from '@pinehill/contracts';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function PUT(request: Request): Promise<Response> {
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: [
      'depositPercent',
      'minNights',
      'maxNights',
      'cancellationPolicyId',
      'status',
      'reason',
    ],
    routeResolver: (req) => {
      if (req.method !== 'PUT') return;
      const id =
        /^\/api\/session\/sys\/rate-plans\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(
          new URL(req.url).pathname,
        )?.[1];
      return id
        ? {
            method: 'PUT',
            path: '/rate-plans/' + id,
            protected: true,
            body: ratePlanUpdateRequestSchema,
          }
        : undefined;
    },
  })(request);
}
