import { ApiError } from '@pinehill/api-client';
import type { AdminData } from './model';
import { allotmentPutRequestSchema, allotmentQuerySchema } from '@pinehill/contracts';
import { gridDates } from '../../../lib/inventory-grid';
import type { AdminCommand } from './intent';
export function validAllotmentTag(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^"[1-9]\d{0,18}"$/.test(value) &&
    BigInt(value.slice(1, -1)) <= 9223372036854775807n
  );
}
export function parseAllotmentCommand(
  value: Record<string, unknown>,
): Extract<AdminCommand, { kind: 'allotment-put' }> {
  if (value.kind !== 'allotment-put' || !validAllotmentTag(value.tag))
    throw Error('Invalid allotment intent');
  const range = allotmentQuerySchema.pick({ from: true, to: true }).parse(value.range);
  if (!gridDates(range.from, range.to).length) throw Error('Invalid allotment intent range');
  const body = allotmentPutRequestSchema.parse(value.body);
  const dates = new Set(body.items.map((item) => item.date));
  if (
    dates.size !== body.items.length ||
    body.items.some(
      (item) =>
        item.date < range.from ||
        item.date > range.to ||
        !gridDates(item.date, item.date).length ||
        !Number.isSafeInteger(item.allotment),
    )
  )
    throw Error('Invalid allotment intent items');
  return { kind: 'allotment-put', tag: value.tag, range, body };
}

export function assertAllotmentSelection(data: AdminData | null, command: AdminCommand): void {
  if (command.kind !== 'allotment-put') return;
  const current = data?.allotment;
  if (
    !current ||
    command.body.channelId !== current.channelId ||
    command.body.roomTypeId !== current.roomTypeId ||
    command.tag !== current.tag ||
    command.range.from !== current.range.from ||
    command.range.to !== current.range.to
  )
    throw new ApiError({ kind: 'aborted', message: 'Allotment selection changed' });
}
