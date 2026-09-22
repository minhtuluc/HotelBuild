import { JSDOM } from 'jsdom';
import { markdown, markdownFiles, read, relative, report } from './lib/docs.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
const errors = [];
let count = 0;
try {
  for (const file of await markdownFiles()) {
    for (const token of markdown.parse(await read(file), {})) {
      if (token.type !== 'fence' || token.info.trim().toLowerCase() !== 'mermaid') continue;
      count++;
      try {
        await mermaid.parse(token.content);
      } catch (error) {
        errors.push(`${relative(file)}:${token.map[0] + 1}: ${error.message}`);
      }
    }
  }
  if (!count) errors.push('No Mermaid fences found; refusing a vacuous pass.');
  report('Mermaid', errors, `${count} diagrams parsed (syntax only; no browser rendering)`);
} finally {
  dom.window.close();
}
