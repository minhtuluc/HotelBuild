import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import MarkdownIt from 'markdown-it';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const markdown = new MarkdownIt({ html: true });
export const read = (file) => readFile(path.resolve(root, file), 'utf8');
export const relative = (file) => path.relative(root, file).replaceAll('\\', '/');

export async function markdownFiles(directory = root) {
  const ignored = new Set(['.git', 'node_modules', '.codex', '.agents', 'coverage']);
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(file));
    else if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(file);
  }
  return files.sort();
}

export function sectionTokens(source, heading, level = 2) {
  const tokens = markdown.parse(source, {});
  const starts = tokens.flatMap((token, i) => token.type === 'heading_open'
    && token.tag === `h${level}` && heading.test(tokens[i + 1].content) ? [i] : []);
  if (starts.length !== 1) throw new Error(`Expected exactly one section ${heading}; found ${starts.length}`);
  const start = starts[0];
  let end = start + 1;
  while (end < tokens.length && !(tokens[end].type === 'heading_open'
    && Number(tokens[end].tag.slice(1)) <= level)) end++;
  return tokens.slice(start, end);
}

export function sqlBlocks(source, heading = /^3\.\s/, level = 2) {
  const blocks = sectionTokens(source, heading, level)
    .filter((token) => token.type === 'fence' && token.info.trim().toLowerCase() === 'sql')
    .map((token) => ({ sql: token.content, line: token.map[0] + 1 }));
  if (!blocks.length) throw new Error(`No SQL fences in ${heading}`);
  return blocks;
}

export function tableRows(tokens) {
  const rows = [];
  let row;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'tr_open') row = [];
    if (tokens[i].type === 'td_open' || tokens[i].type === 'th_open') row.push(tokens[i + 1].content);
    if (tokens[i].type === 'tr_close') rows.push(row);
  }
  return rows;
}

export function report(label, errors, summary) {
  if (errors.length) {
    console.error(`${label}: ${errors.length} error(s)\n${errors.join('\n')}`);
    process.exitCode = 1;
  } else console.log(`${label}: ${summary}`);
}
