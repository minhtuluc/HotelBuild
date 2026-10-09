import { z } from 'zod';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import { AppError } from '../app-error.js';
import type { CommandResponse } from './store.js';
const json = z.json();
const denied = new Set([
  'password',
  'passwordhash',
  'accesstoken',
  'refreshtoken',
  'pintoken',
  'authorization',
]);
const unsafeResponse = () =>
  new AppError(500, 'E_GEN_SERVICE_UNAVAILABLE', 'Không thể lưu phản hồi an toàn.');
const forbiddenHeaders = new Set([
  'set-cookie',
  'authorization',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'trailer',
]);
const headerValue = z.union([z.string(), z.number(), z.array(z.string())]);
function checkHeader(name: string, value: unknown): void {
  if (forbiddenHeaders.has(name)) throw unsafeResponse();
  const parsed = headerValue.safeParse(value);
  if (!parsed.success) throw unsafeResponse();
  try {
    validateHeaderName(name);
    for (const part of Array.isArray(parsed.data) ? parsed.data : [parsed.data])
      validateHeaderValue(name, String(part));
  } catch {
    throw unsafeResponse();
  }
  if (
    name === 'content-type' &&
    (typeof value !== 'string' ||
      !/^application\/(?:json|[\w!#$&^.+-]+\+json)(?:\s*;\s*charset=(?:utf-8|"utf-8"))?$/i.test(
        value,
      ))
  )
    throw unsafeResponse();
}
function checkSecrets(value: unknown, depth = 0): void {
  if (depth > 64) throw unsafeResponse();
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (denied.has(key.toLowerCase().replaceAll('_', ''))) throw unsafeResponse();
    checkSecrets(child, depth + 1);
  }
}
function responseHeaders(source: Readonly<Record<string, unknown>>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [raw, value] of Object.entries(source)) {
    const name = raw.toLowerCase();
    checkHeader(name, value);
    if (['location', 'etag', 'content-type', 'cache-control'].includes(name)) {
      if (typeof value !== 'string') throw unsafeResponse();
      headers[name] = value;
    }
  }
  return headers;
}
export function normalizeResponse(
  status: number,
  body: unknown,
  source: Readonly<Record<string, unknown>>,
): CommandResponse {
  if (!Number.isInteger(status) || status < 200 || status > 299) throw unsafeResponse();
  const headers = responseHeaders(source);
  try {
    const serialized: unknown = JSON.parse(JSON.stringify(body === undefined ? null : body));
    const parsed = json.safeParse(serialized);
    if (!parsed.success) throw unsafeResponse();
    checkSecrets(parsed.data);
    return { status, body: parsed.data, headers };
  } catch {
    throw unsafeResponse();
  }
}
