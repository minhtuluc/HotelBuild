import { dayBoardQuerySchema } from '@pinehill/contracts';
import { invalid, uuid } from '../allotments/validation.js';

export interface DayBoardInput {
  readonly propertyId: string;
  readonly date?: string;
}

export function dayBoardInput(value: unknown): DayBoardInput {
  const result = dayBoardQuerySchema.safeParse(value);
  if (!result.success) throw invalid();
  return {
    propertyId: uuid(result.data.propertyId),
    ...(result.data.date === undefined ? {} : { date: result.data.date }),
  };
}
