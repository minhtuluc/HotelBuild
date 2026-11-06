import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { F6_CATALOGUE, resolveF6 } from '../../src/app/api/session/sys/f6-route';
import { done } from './harness';

const SYS = fileURLToPath(new URL('../../src/app/api/session/sys', import.meta.url));

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' ? [path] : [];
  });
}

const files = routeFiles(SYS).map((path) => relative(SYS, path).replaceAll('\\', '/'));
const dirOf = (pattern: string): string =>
  `${pattern
    .slice(1)
    .split('/')
    .map((part) => (part.startsWith(':') ? `[${part.slice(1)}]` : part))
    .join('/')}/route.ts`;
/** Mẫu tuyến → tham số mẫu (`a b` kiểm mã hoá), dựng đường dẫn BFF. */
const sample = (pattern: string): string =>
  pattern
    .split('/')
    .map((part) => (part.startsWith(':') ? 'a%20b' : part))
    .join('/');
const wired = F6_CATALOGUE.map((entry) => {
  const text = (() => {
    try {
      return readFileSync(join(SYS, dirOf(entry.pattern)), 'utf8');
    } catch {
      return '';
    }
  })();
  return (
    text.includes(`'${entry.id}'`) && new RegExp(`export const ${entry.method} = handle`).test(text)
  );
});
const forwards = F6_CATALOGUE.every((entry) => {
  const hit = resolveF6(F6_CATALOGUE, entry.method, `/api/session/sys${sample(entry.pattern)}`);
  const expected = entry.pattern
    .split('/')
    .map((part) => (part.startsWith(':') ? 'a%20b' : part))
    .join('/');
  return hit?.entry.id === entry.id && hit.route.path === expected && hit.route.protected;
});
const rejects = [
  resolveF6(F6_CATALOGUE, 'DELETE', '/api/session/sys/room-moves/x'),
  resolveF6(F6_CATALOGUE, 'GET', '/api/session/sys/room-moves/x/unknown'),
  resolveF6(F6_CATALOGUE, 'POST', '/api/session/sys/room-moves/a%2Fb/approve'),
  resolveF6(F6_CATALOGUE, 'POST', '/api/session/sys/room-moves/../approve'),
  resolveF6(F6_CATALOGUE, 'POST', '/api/session/sys/room-moves/%2E%2E/approve'),
].every((hit) => hit === undefined);
const modules = [
  '/auth',
  '/properties',
  '/room-types',
  '/channels',
  '/channel-allotments',
  '/operations',
  '/overbooking-cases',
  '/room-moves',
  '/room-merges',
  '/refund-requests',
  '/bookings',
];
const covered = modules.map((module) =>
  files.some(
    (file) => file.startsWith(`${module.slice(1)}/`) || file === `${module.slice(1)}/route.ts`,
  ),
);
done({
  total: F6_CATALOGUE.length,
  writes: F6_CATALOGUE.filter((entry) => entry.method !== 'GET').length,
  uniqueIds: new Set(F6_CATALOGUE.map((entry) => entry.id)).size === F6_CATALOGUE.length,
  allProtectedAndDecoded: F6_CATALOGUE.every((entry) => entry.decoder !== undefined),
  wired: wired.every(Boolean),
  forwards,
  rejects,
  catchAll: files.some((file) => file.includes('[...')),
  pinFieldNeverWhitelisted: F6_CATALOGUE.every((entry) => !entry.fields.includes('pinToken')),
  modulesCovered: covered,
  newRouteFiles: files.filter(
    (file) =>
      /^(overbooking-cases|room-moves|room-merges|refund-requests|auth\/pin)\//.test(file) ||
      /^channels\/\[id\]\/./.test(file) ||
      file === 'refund-requests/route.ts' ||
      file === 'room-moves/route.ts' ||
      file === 'room-merges/route.ts' ||
      file === 'overbooking-cases/route.ts' ||
      file === 'bookings/[id]/relocation-options/route.ts',
  ).length,
});
