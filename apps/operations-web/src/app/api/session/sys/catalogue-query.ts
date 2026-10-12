import { listQuerySchema, roomTypeSummarySchema } from '@pinehill/contracts';
export const propertyCatalogueQuery = listQuerySchema.pick({ limit: true, cursor: true });
export const typeCatalogueQuery = propertyCatalogueQuery.extend({
  propertyId: roomTypeSummarySchema.shape.propertyId.optional(),
});
