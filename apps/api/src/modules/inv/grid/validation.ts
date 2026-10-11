import { inventoryGridQuerySchema } from '@pinehill/contracts';
import { invalid, uuid, validateRange } from '../allotments/validation.js';
export function gridInput(value: unknown) {
  const result = inventoryGridQuerySchema.safeParse(value);
  if (!result.success) throw invalid();
  validateRange(result.data.from, result.data.to);
  return {
    ...result.data,
    propertyId: uuid(result.data.propertyId),
    ...(result.data.roomTypeId ? { roomTypeId: uuid(result.data.roomTypeId) } : {}),
  };
}
export type GridInput = ReturnType<typeof gridInput>;
