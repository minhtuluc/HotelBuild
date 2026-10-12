import {
  systemSettingUpdateRequestSchema,
  type SystemSettingUpdateRequest,
} from '@pinehill/contracts';
export interface SettingIntent {
  key: string;
  ownerId: string;
  settingKey: string;
  body: SystemSettingUpdateRequest;
  tag: string;
  createdAt: number;
}
export function storageKey(ownerId: string): string {
  return 'pinehill-setting:' + encodeURIComponent(ownerId);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function stringField(value: Record<string, unknown>, key: string): string {
  const text = value[key];
  if (typeof text !== 'string' || !text) throw Error('Invalid intent field');
  return text;
}
export function readIntent(raw: string, ownerId: string): SettingIntent {
  const value: unknown = JSON.parse(raw);
  if (!record(value)) throw Error('Invalid intent');
  const key = stringField(value, 'key'),
    settingKey = stringField(value, 'settingKey'),
    owner = stringField(value, 'ownerId'),
    tag = stringField(value, 'tag');
  if (
    owner !== ownerId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key) ||
    !/^"\d+"$/.test(tag)
  )
    throw Error('Invalid intent binding');
  const createdAt = value.createdAt;
  if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt < 0)
    throw Error('Invalid intent time');
  return {
    key,
    ownerId: owner,
    settingKey,
    tag,
    createdAt,
    body: systemSettingUpdateRequestSchema.parse(value.body),
  };
}
export function replayAllowed(intent: SettingIntent, now: number): boolean {
  return now >= intent.createdAt && now - intent.createdAt < 86400000;
}
