import { createJourneyHandler } from '@pinehill/web-session/server';
import { strictPolicy, policyBody } from '../../../../../../lib/rate-config-schemas';
import { sessionConfig } from '../../../../../../config/session';
export const dynamic = 'force-dynamic';
export async function PUT(request: Request): Promise<Response> {
  const fields = ['tiers', 'earlyCheckoutFreeHours', 'earlyCheckoutRefundPct', 'reason'];
  const body = {
    parse(value: unknown) {
      const parsed = policyBody.parse(value);
      for (const [index] of parsed.tiers.entries())
        for (const name of [
          'hoursBeforeCheckIn',
          'offsetHours',
          'refundPercent',
          'chargeFirstNight',
        ])
          fields.push(`tiers[${index}].${name}`);
      return parsed;
    },
  };
  return createJourneyHandler({
    ...sessionConfig(),
    validationFields: fields,
    routeResolver: (req) => {
      if (req.method !== 'PUT') return;
      const id =
        /^\/api\/session\/sys\/cancellation-policies\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(
          new URL(req.url).pathname,
        )?.[1];
      return id
        ? {
            method: 'PUT',
            path: '/cancellation-policies/' + id,
            protected: true,
            maxBodyBytes: 1048576, // Matches the existing Fastify API cap for full-list replacement.
            body,
            decoder: strictPolicy,
          }
        : undefined;
    },
  })(request);
}
