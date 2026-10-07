import { createServer, type IncomingMessage } from 'node:http';
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { FakeApiContext, FakeHandler, FakeRequest, FakeResponse } from './core/types.js';

async function handlers(): Promise<FakeHandler[]> {
  const found: FakeHandler[] = [];
  const context: FakeApiContext = {};
  for (const group of ['core', 'staff', 'users', 'guest', 'journey']) {
    const dir = new URL(`./${group}/`, import.meta.url);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        continue;
      throw error;
    }
    for (const file of entries.sort()) {
      if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
      const module: unknown = await import(pathToFileURL(fileURLToPath(new URL(file, dir))).href);
      if (isPlugin(module)) found.push(module.createHandler(context));
    }
  }
  return found;
}
function isPlugin(
  value: unknown,
): value is { createHandler: (context: FakeApiContext) => FakeHandler } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createHandler' in value &&
    typeof value.createHandler === 'function'
  );
}
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk: unknown = value;
    if (!(chunk instanceof Uint8Array)) throw new Error('Invalid chunk');
    size += chunk.byteLength;
    if (size > 16384) throw new Error('Body limit');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString();
  if (!text) return undefined;
  const parsed: unknown = JSON.parse(text);
  return parsed;
}
export async function startFakeApi(baseUrl: string) {
  const target = new URL(baseUrl);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1')
    throw new Error('Fake API must bind loopback HTTP');
  const registry = await handlers();
  const built = await build({
    entryPoints: [
      fileURLToPath(new URL('../../../packages/web-session/src/client.ts', import.meta.url)),
    ],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  const asset = built.outputFiles[0]!.text;
  const origins = (
    process.env.E2E_APP_ORIGINS ?? 'http://127.0.0.1:3001,http://127.0.0.1:3002'
  ).split(',');
  const server = createServer((req, res) => {
    void (async () => {
      const origin = req.headers.origin;
      if (origin && !origins.includes(origin)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (origin) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-methods': 'GET,POST,PUT,DELETE',
          'access-control-allow-headers':
            'content-type,authorization,x-correlation-id,idempotency-key,if-match',
        });
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', target);
      if (url.pathname === '/__test/session-client.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(asset);
        return;
      }
      const request: FakeRequest = {
        url,
        method: req.method ?? 'GET',
        body: await body(req),
        authorization: req.headers.authorization,
        ...(typeof req.headers['idempotency-key'] === 'string'
          ? { idempotencyKey: req.headers['idempotency-key'] }
          : {}),
      };
      let result: FakeResponse | undefined;
      for (const handler of registry) {
        result = await handler(request);
        if (result) break;
      }
      result ??= { status: 404, body: { code: 'E_GEN_NOT_FOUND' } };
      res.writeHead(result.status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...result.headers,
      });
      res.end(result.body === undefined ? undefined : JSON.stringify(result.body));
    })().catch(() => {
      res.writeHead(400);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(Number(target.port), '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fake API port');
  return { server, url: `http://127.0.0.1:${address.port}/api/v1` };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const running = await startFakeApi(
    process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1',
  );
  process.stdout.write(`Fake HTTP API ready ${running.url}\n`);
  const close = () =>
    running.server.close(() => {
      process.exitCode = 0;
    });
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}
