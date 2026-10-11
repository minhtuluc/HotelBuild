import { auditLogEntrySchema } from '@pinehill/contracts';
import { safeAuditText, secretSettingKey } from './safe-text.js';
const fields = new Set([
  'id',
  'key',
  'propertyId',
  'property_id',
  'roomId',
  'roomTypeId',
  'status',
  'version',
  'code',
  'name',
  'value',
  'valueType',
  'value_type',
  'quota',
  'used',
  'closed',
  'remaining',
  'reason',
  'note',
  'limit',
  'active',
  'basePrice',
  'minPrice',
  'maxPrice',
  'depositPercent',
  'discountPercent',
  'amount',
  'before',
  'after',
  'room_id',
  'room_type_id',
  'startDate',
  'endDate',
  'start_date',
  'end_date',
  'created_at',
  'updated_at',
  'minNights',
  'maxNights',
  'cancellationPolicyId',
  'fixedNightlyPrice',
  'losDiscountEnabled',
  'rescheduleAllowed',
  'rescheduleMinHours',
  'rescheduleFeePct',
  'maxReschedules',
  'policy',
  'isDefault',
  'earlyCheckoutFreeHours',
  'earlyCheckoutRefundPct',
  'tiers',
  'offsetHours',
  'refundPercent',
  'chargeFirstNight',
  'label',
  'sortOrder',
  'channelId',
  'items',
  'date',
  'allotment',
  'isClosed',
  'closedReason',
  'closedAt',
  'businessDate',
  'roomCode',
  'assignedTo',
  'completedAt',
  'clientSurface',
]);
function safeText(value: string, depth: number): string {
  // JSON encoded inside a value field must obey the same recursive whitelist.
  if (/^[\[{]/.test(value.trim())) {
    try {
      const parsed: unknown = JSON.parse(value);
      return JSON.stringify(safeSnapshot(parsed, depth + 1));
    } catch {
      return safeAuditText(value);
    }
  }
  return safeAuditText(value);
}
export function safeSnapshot(value: unknown, depth = 0): unknown {
  if (depth > 16) return null;
  if (typeof value === 'string') return safeText(value, depth);
  if (value === null || ['boolean', 'number'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map((item) => safeSnapshot(item, depth + 1));
  if (typeof value !== 'object') return null;
  return safeFields(value, depth);
}
function safeFields(value: object, depth: number): Record<string, unknown> {
  const entries = Object.entries(value),
    output: Record<string, unknown> = {};
  const typedNumber = ['valueType', 'value_type'].some(
    (key) => Reflect.get(value, key) === 'NUMBER',
  );
  const moneyKey = [
    'refund.feeAmount',
    'deal.threshold.minor',
    'deal.threshold.checkInDebt',
    'overbooking.transportSupportCap',
  ].includes(String(Reflect.get(value, 'key')));
  const secret = secretSettingKey(String(Reflect.get(value, 'key')));
  for (const [key, item] of entries)
    if (fields.has(key)) output[key] = safeField(key, item, depth, typedNumber || moneyKey, secret);
  return output;
}
function safeField(
  key: string,
  item: unknown,
  depth: number,
  numeric: boolean,
  secret: boolean,
): unknown {
  if (key === 'value' && secret) return '[REDACTED]';
  if (
    typeof item === 'string' &&
    idField(key) &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item)
  )
    return item;
  if (key === 'value' && numeric && typeof item === 'string' && /^-?\d+(?:\.\d+)?$/.test(item))
    return item;
  return safeSnapshot(item, depth + 1);
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  before_json: unknown;
  after_json: unknown;
  at: Date;
}
export function project(row: AuditRow) {
  return auditLogEntrySchema.parse({
    id: row.id,
    actorId: row.actor_id ?? 'SYSTEM',
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? 'GLOBAL',
    reason: row.reason === null ? null : safeAuditText(row.reason),
    beforeJson: row.before_json === null ? null : JSON.stringify(safeSnapshot(row.before_json)),
    afterJson: row.after_json === null ? null : JSON.stringify(safeSnapshot(row.after_json)),
    createdAt: row.at.toISOString(),
  });
}

function idField(key: string): boolean {
  return key === 'id' || key.endsWith('Id') || key.endsWith('_id') || key === 'assignedTo';
}
