import { pathToFileURL } from 'node:url';
import { read, sqlBlocks } from './lib/docs.mjs';

export async function extractDDL() {
  return sqlBlocks(await read('docs/04-thiet-ke/csdl.md'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // stdout is SQL only. Sections 4/7 repeat DDL and must never be replayed.
  for (const block of await extractDDL()) {
    process.stdout.write(`-- docs/04-thiet-ke/csdl.md:${block.line}\n${block.sql}\n`);
  }
}
