import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const api = createRequire(path.join(root, 'apps/api/package.json'));
const android = createRequire(path.join(root, 'apps/customer-android/package.json'));
const adapter = createRequire(api.resolve('@nestjs/platform-fastify'));
const vitest = createRequire(api.resolve('vitest'));
const prisma = createRequire(api.resolve('prisma/package.json'));
const prismaConfig = createRequire(prisma.resolve('@prisma/config'));
const devtools = createRequire(
  createRequire(android.resolve('react-native/package.json')).resolve('react-devtools-core'),
);
const { quote, parse } = devtools('shell-quote');

test('the Fastify used by Nest rejects malformed URLs before an unrelated protected fallback', async () => {
  const fastify = adapter('fastify')();
  let privateCalls = 0;
  try {
    fastify.register(
      async (route) => {
        route.get('/known', async () => 'synthetic public');
        route.setNotFoundHandler((_request, reply) => reply.code(404).send('synthetic missing'));
      },
      { prefix: '/visible' },
    );
    fastify.register(
      async (route) => {
        route.setNotFoundHandler(
          {
            preHandler: async (request, reply) => {
              if (request.headers['x-synthetic-permit'] !== '1')
                return reply.code(401).send('denied');
            },
          },
          (_request, reply) => {
            privateCalls++;
            reply.send('SYNTHETIC_PRIVATE_CANARY');
          },
        );
      },
      { prefix: '/restricted' },
    );
    const malformed = await fastify.inject({ method: 'DELETE', url: '/visible/%c0' });
    assert.equal(malformed.statusCode, 400);
    assert(!malformed.body.includes('SYNTHETIC_PRIVATE_CANARY'));
    assert.equal(privateCalls, 0);
    assert.equal(
      (await fastify.inject({ method: 'DELETE', url: '/restricted/missing' })).statusCode,
      401,
    );
    assert.equal(
      (
        await fastify.inject({
          method: 'DELETE',
          url: '/restricted/missing',
          headers: { 'x-synthetic-permit': '1' },
        })
      ).statusCode,
      200,
    );
    assert.equal(privateCalls, 1);
  } finally {
    await fastify.close();
  }
});

for (const pollution of ['filename', 'execArgv']) {
  test(`the Tinypool used by Vitest ignores inherited ${pollution} options`, () => {
    const owned = mkdtempSync(path.join(tmpdir(), 'hb183-pool-'));
    try {
      const legitimate = path.join(owned, 'legitimate.mjs'),
        other = path.join(owned, 'other.mjs');
      writeFileSync(
        legitimate,
        "export default () => ({source:'legitimate',inherited:process.execArgv.includes('--conditions=HB183_INHERITED')});\n",
      );
      writeFileSync(other, "export default () => ({source:'unexpected',inherited:false});\n");
      const script = path.join(owned, 'probe.mjs');
      writeFileSync(
        script,
        `
import { pathToFileURL } from 'node:url';
const {default: Tinypool} = await import(pathToFileURL(${JSON.stringify(vitest.resolve('tinypool'))}));
let pool;
try {
  ${pollution === 'execArgv' ? "Object.prototype.execArgv = ['--conditions=HB183_INHERITED'];" : ''}
  pool = new Tinypool({filename:${JSON.stringify(legitimate)},minThreads:1,maxThreads:1});
  ${pollution === 'filename' ? 'Object.prototype.filename = ' + JSON.stringify(other) + ';' : ''}
  const output = await pool.run({synthetic:true}, {signal:new AbortController().signal});
  process.stdout.write(JSON.stringify(output));
} finally {
  delete Object.prototype.filename;
  delete Object.prototype.execArgv;
  if (pool) await pool.destroy();
}
`,
      );
      const result = spawnSync(process.execPath, ['--max-old-space-size=64', script], {
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { source: 'legitimate', inherited: false });
    } finally {
      rmSync(owned, { recursive: true, force: true });
    }
  });
}

for (const separator of ['\n', '\r', '\u2028', '\u2029']) {
  test(`React Native tooling shell quoting rejects post-comment terminator ${separator.charCodeAt(0)}`, () => {
    assert.throws(
      () =>
        quote([
          'printf',
          'synthetic',
          { comment: 'owned fixture' },
          'text' + separator + 'printf unexpected',
        ]),
      TypeError,
    );
  });
}
test('ordinary shell arguments retain their exact meaning', () => {
  const args = ['printf', '%s', 'safe text', 'literal;symbol', "a'b"];
  assert.deepEqual(parse(quote(args)), args);
});

test('Prisma dependency merges cyclic plain records without exhausting the stack', () => {
  const { deepmerge } = prismaConfig('deepmerge-ts');
  const left = { alpha: 1 },
    right = { beta: 2 };
  left.self = left;
  right.self = right;
  const merged = deepmerge(left, right);
  assert.equal(merged.alpha, 1);
  assert.equal(merged.beta, 2);
  assert.equal(merged.self, merged);
});

test('source-map consumer rejects an indexed section offset that can amplify output', () => {
  const coverage = createRequire(api.resolve('@vitest/coverage-v8'));
  const magicast = createRequire(coverage.resolve('magicast'));
  const { SourceMapConsumer } = magicast('source-map-js');
  assert.throws(
    () =>
      new SourceMapConsumer({
        version: 3,
        sections: [
          {
            offset: { line: 100000000, column: 0 },
            map: { version: 3, sources: ['synthetic.ts'], names: [], mappings: 'AAAA' },
          },
        ],
      }),
    /offset|section|limit/i,
  );
});
test('Next image processing still loads the native binding and renders owned SVG input', async () => {
  const web = createRequire(path.join(root, 'apps/customer-web/package.json'));
  const next = createRequire(web.resolve('next'));
  const sharp = next('sharp');
  const buffer = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3" fill="blue"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const info = await sharp(buffer).metadata();
  assert.equal(info.width, 2);
  assert.equal(info.height, 3);
  assert.equal(info.format, 'png');
});

test('Prisma 6 loads its own config through the updated merger and validates an owned schema', () => {
  const owned = mkdtempSync(path.join(tmpdir(), 'hb183-prisma-'));
  try {
    const schema = path.join(owned, 'schema.prisma'),
      config = path.join(owned, 'prisma.config.mjs');
    writeFileSync(
      schema,
      'datasource db {\n  provider = "postgresql"\n  url = env("HB183_DATABASE_URL")\n}\nmodel SyntheticRecord {\n  id String @id\n}\n',
    );
    writeFileSync(
      config,
      `import {createRequire} from 'node:module';\nconst {defineConfig}=createRequire(${JSON.stringify(path.join(root, 'apps/api/package.json'))})('prisma/config');\nexport default defineConfig({schema:${JSON.stringify(schema)}});\n`,
    );
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(
          path.dirname(api.resolve('prisma/package.json')),
          api('prisma/package.json').bin.prisma,
        ),
        'validate',
        '--config',
        config,
      ],
      {
        cwd: owned,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, HB183_DATABASE_URL: 'postgresql://127.0.0.1:5432/synthetic' },
      },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(owned, { recursive: true, force: true });
  }
});
