import test from 'node:test';
import assert from 'node:assert/strict';
import { sqlBlocks } from '../scripts/lib/docs.mjs';
import { anchors } from '../scripts/check-links.mjs';
import { acceptedExemptions, cancellationCases, definitions, referencedIds } from '../scripts/check-ids.mjs';
import { compareContracts } from '../scripts/lib/openapi-diff.mjs';

test('DDL extraction uses only §3 SQL fences, in document order', () => {
  const source = '# DB\n## 2. Diagram\n```sql\nOUTSIDE;\n```\n## 3. DDL\n### 3.1. Foundation\n```sql\nFIRST;\n```\n```text\nIGNORE;\n```\n### 3.2. Tables\n```sql\nSECOND;\n```\n## 4. Repeated snippets\n```sql\nFIRST;\n```';
  assert.deepEqual(sqlBlocks(source).map((b) => b.sql.trim()), ['FIRST;', 'SECOND;']);
  assert.throws(() => sqlBlocks('## 4. Missing'), /exactly one section/);
  assert.throws(() => sqlBlocks('## 3. Empty'), /No SQL fences/);
});

test('anchors preserve Vietnamese, strip inline markup, and disambiguate repeats', () => {
  const values = anchors('# Giá **phòng**\n## Giá **phòng**\n<a id="custom"></a>');
  assert.ok(values.has('giá-phòng'));
  assert.ok(values.has('giá-phòng-1'));
  assert.ok(values.has('custom'));
});

test('ID ranges include interior references and slash shorthand', () => {
  assert.deepEqual([...referencedIds('TC-BOOK-26/28')].sort(), ['TC-BOOK-26', 'TC-BOOK-28']);
  assert.deepEqual([...referencedIds('BR-RATE-01..03')].sort(), ['BR-RATE-01', 'BR-RATE-02', 'BR-RATE-03']);
  assert.deepEqual([...referencedIds('BR-INV-02/03')].sort(), ['BR-INV-02', 'BR-INV-03']);
  assert.equal(referencedIds('BR-FO-* FR-<MOD>-<nn>').size, 0);
  assert.throws(() => referencedIds('BR-RATE-09..01'), /Invalid ID range/);
});

test('cancellation cases are defined only in decision, boundary, exception and property tables', () => {
  const source = [
    '## 1. Trace\n\n| ID | TC |\n|---|---|\n| BR-CANCEL-01 | TC-CANCEL-99 |',
    '## 6. Decisions\n\n| Row | Case |\n|---|---|\n| DT-01 | TC-CANCEL-01 |\n| DT-02 | TC-CANCEL-01 |',
    '## 8. Boundaries\n\n| Time | A | B | C | D | Case |\n|---|---|---|---|---|---|\n| 24h | 0 | 0 | 0 | 0 | TC-CANCEL-35 |',
    '## 9. Exceptions\n\n| Row | Name | BR | Input | Output | Role | Case |\n|---|---|---|---|---|---|---|\n| 9.1 | X | X | X | X | X | TC-CANCEL-50 |\n| 9.2 | X | X | X | X | X | TC-CANCEL-01, TC-CANCEL-35 |',
    '## 11. Properties\n\n| Row | Invariant | BR | Case |\n|---|---|---|---|\n| P1 | Bound | BR-PAY-07 | TC-CANCEL-44 |',
  ].join('\n\n');
  assert.deepEqual([...cancellationCases(source)], [['TC-CANCEL-01', 2], ['TC-CANCEL-35', 1], ['TC-CANCEL-50', 1], ['TC-CANCEL-44', 1]]);
});

test('canonical definitions distinguish table definitions from mentions and duplicates', () => {
  const values = definitions('Mention BR-GEN-99.\n\n| Mã | Rule |\n|---|---|\n| BR-GEN-01 | Text BR-GEN-02 |\n| BR-GEN-01 | duplicate |', 'BR');
  assert.deepEqual([...values], [['BR-GEN-01', 2]]);
});

test('NFR definitions include LOC but exclude later trace tables; true duplicates still fail', () => {
  const table = (id) => `\n\n| Mã | Requirement |\n|---|---|\n| ${id} | Text |\n`;
  const source = `## 2. NFR-PERF — Performance${table('NFR-PERF-01')}${table('NFR-PERF-01')}\n## 9. NFR-LOC — Localization${table('NFR-LOC-01')}\n## 10. Trace matrix${table('NFR-PERF-01')}${table('NFR-LOC-01')}${table('NFR-SEC-99')}`;
  assert.deepEqual([...definitions(source, 'NFR')], [['NFR-PERF-01', 2], ['NFR-LOC-01', 1]]);
});

test('accepted exemptions use named columns with optional condition and reordered fields', () => {
  const source = '## 6. Lỗ hổng truy vết\n\n| # | BR | Điều kiện | Ô trống | Việc cần làm | Vì sao không có mã |\n|---|---|---|---|---|---|\n| 1 | BR-GEN-01 | contract test | API | **Chấp nhận** | Cross-cutting rule |\n| 2 | BR-GEN-02 | test | Entity | Cần sửa | Missing mapping |\n| 3 | BR-GEN-03 | test | API | Chấp nhận | |\n| 4 | BR-GEN-04 | test | API | Chấp nhận; Cần sửa | Unresolved |\n## 7. Elsewhere\n\n| # | BR | Điều kiện | Ô trống | Việc cần làm | Vì sao không có mã |\n|---|---|---|---|---|---|\n| 5 | BR-GEN-05 | test | API | Chấp nhận | Not in section 6 |';
  assert.deepEqual([...acceptedExemptions(source)], [['BR-GEN-01:API', 'Cross-cutting rule']]);
});

test('accepted exemption distinguishes no correction needed from an unresolved correction', () => {
  const source = '## 6. Exceptions\n\n| BR | Ô trống | Việc cần làm | Vì sao không có mã |\n|---|---|---|---|\n| BR-GEN-01 | API | **Chấp nhận**. Không cần sửa xương sống. | Cross-cutting |\n| BR-GEN-02 | API | Chấp nhận; cần sửa hợp đồng. | Unresolved |';
  assert.deepEqual([...acceptedExemptions(source)], [['BR-GEN-01:API', 'Cross-cutting']]);
});

test('contract diff flags breaking changes and ignores compatible ones', () => {
  const schema = (properties, required = []) => ({ type: 'object', properties, required });
  const operation = (overrides = {}) => ({
    request: { body: { content: { 'application/json': { schema: schema({ username: { type: 'string' } }, ['username']) } } } },
    responses: { 200: { content: { 'application/json': { schema: schema({ accessToken: { type: 'string' } }, ['accessToken']) } } } },
    ...overrides,
  });
  const baseline = {
    info: { version: '1.0.0' },
    paths: {
      '/api/v1/auth/login': { post: operation() },
      '/api/v1/system/health': { get: { responses: { 200: { description: 'ok' } } } },
    },
  };

  assert.deepEqual(compareContracts(baseline, baseline).breaking, []);

  const removedPath = { ...baseline, paths: { '/api/v1/auth/login': baseline.paths['/api/v1/auth/login'] } };
  assert.match(compareContracts(baseline, removedPath).breaking.join('\n'), /bỏ path \/api\/v1\/system\/health/);

  const removedMethod = {
    ...baseline,
    paths: { ...baseline.paths, '/api/v1/auth/login': { get: { responses: { 200: { description: 'x' } } } } },
  };
  assert.match(compareContracts(baseline, removedMethod).breaking.join('\n'), /bỏ phương thức POST \/api\/v1\/auth\/login/);

  const extraRequiredRequest = {
    ...baseline,
    paths: {
      ...baseline.paths,
      '/api/v1/auth/login': {
        post: operation({
          request: {
            body: {
              content: {
                'application/json': {
                  schema: schema({ username: { type: 'string' }, propertyId: { type: 'string' } }, ['username', 'propertyId']),
                },
              },
            },
          },
        }),
      },
    },
  };
  assert.match(compareContracts(baseline, extraRequiredRequest).breaking.join('\n'), /thêm trường bắt buộc "propertyId"/);

  const removedResponseProperty = {
    ...baseline,
    paths: {
      ...baseline.paths,
      '/api/v1/auth/login': {
        post: operation({
          responses: { 200: { content: { 'application/json': { schema: schema({ refreshToken: { type: 'string' } }, ['refreshToken']) } } } },
        }),
      },
    },
  };
  assert.match(compareContracts(baseline, removedResponseProperty).breaking.join('\n'), /bỏ thuộc tính "accessToken"/);

  const newlyRequiredParameter = {
    ...baseline,
    paths: {
      ...baseline.paths,
      '/api/v1/auth/login': { post: { ...operation(), parameters: [{ in: 'header', name: 'X-Tenant', required: true }] } },
    },
  };
  assert.match(compareContracts(baseline, newlyRequiredParameter).breaking.join('\n'), /thêm tham số bắt buộc "X-Tenant"/);

  const enumBaseline = {
    ...baseline,
    paths: {
      ...baseline.paths,
      '/api/v1/channels/{channelId}': {
        get: {
          responses: {
            200: { content: { 'application/json': { schema: { type: 'object', properties: { syncStatus: { type: 'string', enum: ['OK', 'DEGRADED'] } } } } } },
          },
        },
      },
    },
  };
  const enumShrink = {
    ...enumBaseline,
    paths: {
      ...enumBaseline.paths,
      '/api/v1/channels/{channelId}': {
        get: {
          responses: {
            200: { content: { 'application/json': { schema: { type: 'object', properties: { syncStatus: { type: 'string', enum: ['OK'] } } } } } },
          },
        },
      },
    },
  };
  assert.match(compareContracts(enumBaseline, enumShrink).breaking.join('\n'), /thu hẹp enum/);
  const enumGrow = {
    ...enumBaseline,
    paths: {
      ...enumBaseline.paths,
      '/api/v1/channels/{channelId}': {
        get: {
          responses: {
            200: { content: { 'application/json': { schema: { type: 'object', properties: { syncStatus: { type: 'string', enum: ['OK', 'DEGRADED', 'PAUSED'] } } } } } },
          },
        },
      },
    },
  };
  const enumGrowResult = compareContracts(enumBaseline, enumGrow);
  assert.deepEqual(enumGrowResult.breaking, []);
  assert.match(enumGrowResult.additive.join('\n'), /thêm giá trị enum/);

  const compatible = {
    ...baseline,
    paths: {
      ...baseline.paths,
      '/api/v1/auth/login': {
        post: operation({
          request: {
            body: {
              content: {
                'application/json': { schema: schema({ username: { type: 'string' }, tenant: { type: 'string' } }, ['username']) },
              },
            },
          },
          responses: {
            200: { content: { 'application/json': { schema: schema({ accessToken: { type: 'string' }, scope: { type: 'string' } }, ['accessToken']) } } },
            429: { description: 'rate limited' },
          },
        }),
      },
      '/api/v1/auth/logout': { post: { responses: { 204: { description: 'ok' } } } },
    },
  };
  const compatibleResult = compareContracts(baseline, compatible);
  assert.deepEqual(compatibleResult.breaking, []);
  assert.ok(compatibleResult.additive.length >= 3);
});

test('pr:merge từ chối PR nháp, check chưa xanh hoặc thiếu check bắt buộc', async () => {
  const { mergeBlockers, REQUIRED_CHECKS } = await import('../scripts/merge-pr.mjs');
  const pr = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE' };
  const green = REQUIRED_CHECKS.map((name) => ({ name, state: 'SUCCESS' }));
  assert.deepEqual(mergeBlockers(pr, green), []);
  assert.match(mergeBlockers({ ...pr, isDraft: true }, green).join(), /nháp/);
  assert.match(mergeBlockers(pr, [...green.slice(1), { name: REQUIRED_CHECKS[0], state: 'FAILURE' }]).join(), /FAILURE/);
  assert.match(mergeBlockers(pr, green.slice(1)).join(), /thiếu check bắt buộc/);
  assert.match(mergeBlockers(pr, [...green, { name: 'docs-and-embedded', state: 'IN_PROGRESS' }]).join(), /IN_PROGRESS/);
  assert.match(mergeBlockers({ ...pr, mergeable: 'CONFLICTING' }, green).join(), /xung đột/);
});

test('mọi workspace chạy vitest đều có test:coverage để CI không bỏ qua test đơn vị', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const root = new URL('..', import.meta.url);
  const missing = [];
  for (const group of ['apps', 'packages']) {
    const entries = await readdir(new URL(`${group}/`, root), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkg = JSON.parse(
        await readFile(new URL(`${group}/${entry.name}/package.json`, root), 'utf8'),
      );
      const scripts = pkg.scripts ?? {};
      if (!(scripts.test ?? '').includes('vitest')) continue;
      const hasCoverageScript = typeof scripts['test:coverage'] === 'string';
      const hasCoverageDep = '@vitest/coverage-v8' in (pkg.devDependencies ?? {});
      if (!hasCoverageScript || !hasCoverageDep) missing.push(`${group}/${entry.name}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('mọi app Expo có build Android Hermes để products:build không bỏ qua', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const apps = new URL('../apps/', import.meta.url);
  for (const entry of await readdir(apps, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkg = JSON.parse(await readFile(new URL(`${entry.name}/package.json`, apps), 'utf8'));
    if (!pkg.dependencies?.expo) continue;
    const build = pkg.scripts?.build ?? '';
    assert.match(build, /expo export/, entry.name);
    assert.match(build, /--platform android/, entry.name);
    assert.doesNotMatch(build, /--no-bytecode|--dev/, entry.name);
    assert.match(build, /check-android-hermes\.mjs/, entry.name);
  }
});

test('Hermes build gate validates the exported Android artifact and rejects JSC/missing/empty bundles', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const script = new URL('../scripts/check-android-hermes.mjs', import.meta.url);
async function fixture(bundle, content) {
  const root = await mkdtemp(path.join(tmpdir(), 'pinehill-hermes-'));
  const dist = path.join(root, 'dist');
  await mkdir(dist);
  await writeFile(path.join(dist, 'metadata.json'), JSON.stringify({ fileMetadata: { android: { bundle } } }));
  if (content !== undefined) await writeFile(path.join(dist, bundle), content);
  return { root, run: () => spawnSync(process.execPath, [fileURLToPath(script), dist], { encoding: 'utf8' }) };
}
  for (const [bundle, content, succeeds] of [
    ['entry.hbc', 'synthetic-bytecode-fixture', true],
    ['entry.js', 'synthetic-JSC', false],
    ['entry.hbc', undefined, false],
    ['entry.hbc', '', false],
  ]) {
    const f = await fixture(bundle, content);
    try { assert.equal(f.run().status === 0, succeeds, bundle); }
    finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
