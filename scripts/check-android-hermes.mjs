/** Fail product CI when Expo did not emit the requested Android Hermes artifact. */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const dist = path.resolve(process.argv[2] ?? 'dist');
const metadata = JSON.parse(await readFile(path.join(dist, 'metadata.json'), 'utf8'));
const bundle = metadata.fileMetadata?.android?.bundle;
assert.equal(typeof bundle, 'string', 'Android export metadata must identify its bundle');
assert.ok(bundle.endsWith('.hbc'), 'Android build must export Hermes bytecode, not JSC');
const target = path.resolve(dist, bundle);
assert.ok(target.startsWith(dist + path.sep), 'Bundle must belong to the export directory');
const artifact = await stat(target);
assert.ok(artifact.isFile() && artifact.size > 0, 'Hermes artifact must exist and be nonempty');
console.log('Android Hermes export verified');
