import { allotmentPutRequestSchema, allotmentQuerySchema } from '@pinehill/contracts';
import { gridDates } from '../../../../../lib/inventory-grid';
export const allotmentRead = {
  parse(value: unknown) {
    const query = allotmentQuerySchema.parse(value);
    if (!gridDates(query.from, query.to).length) throw Error('Invalid range');
    return query;
  },
};
export const allotmentBody = {
  parse(value: unknown) {
    const body = allotmentPutRequestSchema.parse(value);
    if (
      new Set(body.items.map((item) => item.date)).size !== body.items.length ||
      body.items.some(
        (item) => !gridDates(item.date, item.date).length || !Number.isSafeInteger(item.allotment),
      )
    )
      throw Error('Invalid items');
    return body;
  },
};
