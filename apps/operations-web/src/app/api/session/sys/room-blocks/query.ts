import { roomBlockSchema, roomBlockCreateRequestSchema } from '@pinehill/contracts';
import { propertyCatalogueQuery } from '../catalogue-query';
import { validBlockDate } from '../../../../../lib/room-blocks';
export const blockCreateBody = roomBlockCreateRequestSchema.refine(
  (input) =>
    validBlockDate(input.startDate) &&
    validBlockDate(input.endDate) &&
    input.startDate < input.endDate,
);
const date = roomBlockSchema.shape.startDate.refine(validBlockDate);
export const blockListQuery = propertyCatalogueQuery
  .extend({
    propertyId: roomBlockSchema.shape.roomId.optional(),
    roomId: roomBlockSchema.shape.roomId.optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .refine((input) => input.from === undefined || input.to === undefined || input.from < input.to);
// The established backend deletion boundary uses the same nonempty500-char operational text.
export const blockDeleteQuery = roomBlockCreateRequestSchema
  .pick({ note: true })
  .omit({ note: true })
  .extend({
    reason: roomBlockCreateRequestSchema.shape.note.unwrap().trim(),
  });
