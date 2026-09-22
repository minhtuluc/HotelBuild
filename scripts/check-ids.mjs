import { markdown, markdownFiles, read, relative, sectionTokens, tableRows, report } from './lib/docs.mjs';

const canonical = {
  BR: 'docs/02-nghiep-vu/quy-tac-nghiep-vu.md',
  FR: 'docs/01-yeu-cau/yeu-cau-chuc-nang.md',
  UC: 'docs/00-tong-quan.md',
  NFR: 'docs/01-yeu-cau/yeu-cau-phi-chuc-nang.md',
  TC: 'docs/05-ke-hoach/ke-hoach-kiem-thu.md',
};
const idPattern = /\b(?:BR|FR|UC|NFR|TC)-[A-Z]+-\d{2,}\b/g;

export function referencedIds(text) {
  const result = new Set(text.match(idPattern) ?? []);
  // Expand shorthand such as BR-RATE-01..19, UC-BOOK-01…UC-BOOK-08,
  // BR-INV-02/03. Wildcards BR-RATE-* and placeholders are not concrete IDs.
  const range = /\b((?:BR|FR|UC|NFR|TC)-[A-Z]+-)(\d{2,})(\s*(?:\.\.|…|–|—|-)\s*(?:\1)?(\d{2,})|(?:\/\d{2,})+)/g;
  for (const match of text.matchAll(range)) {
    if (match[4]) {
      const start = Number(match[2]);
      const end = Number(match[4]);
      if (end < start || end - start > 500) throw new Error(`Invalid ID range: ${match[0]}`);
      for (let n = start; n <= end; n++) result.add(`${match[1]}${String(n).padStart(2, '0')}`);
    } else {
      for (const n of match[3].split('/').filter(Boolean)) result.add(`${match[1]}${n}`);
    }
  }
  return result;
}

export function definitions(source, prefix) {
  let tokens = prefix === 'UC' ? sectionTokens(source, /^8\.\s/) : markdown.parse(source, {});
  if (prefix === 'NFR') {
    // Only the named definition groups, never the later target/trace matrices.
    let inDefinition = false;
    tokens = tokens.filter((token, i, all) => {
      if (token.type === 'heading_open' && token.tag === 'h2') {
        inDefinition = /^\d+\.\s+NFR-[A-Z]+\b/.test(all[i + 1].content);
      }
      return inDefinition;
    });
  }
  const pattern = new RegExp(`^${prefix}-[A-Z]+-\\d{2,}$`);
  const found = new Map();
  for (const row of tableRows(tokens)) {
    const value = row[prefix === 'UC' ? 1 : 0]?.replace(/[*`]/g, '').trim();
    if (pattern.test(value)) found.set(value, (found.get(value) ?? 0) + 1);
  }
  return found;
}

export function acceptedExemptions(source) {
  const rows = tableRows(sectionTokens(source, /^6\.\s/));
  const exemptions = new Map();
  let headers;
  const clean = (value) => value?.replace(/[*`]/g, '').trim();
  for (const row of rows) {
    const cells = row.map(clean);
    if (cells.includes('BR') && cells.includes('Ô trống')) {
      headers = cells;
      continue;
    }
    if (!headers) continue;
    const get = (name) => row[headers.indexOf(name)];
    const decision = get('Việc cần làm') ?? '';
    const reason = get('Vì sao không có mã');
    const column = clean(get('Ô trống'));
    if (!['FR', 'UC', 'API', 'Entity', 'TC'].includes(column)
      || !/Chấp nhận/i.test(decision) || /Cần sửa/i.test(decision.replace(/Không cần sửa/gi, '')) || !reason?.trim()) continue;
    for (const id of referencedIds(get('BR') ?? '')) exemptions.set(`${id}:${column}`, reason);
  }
  return exemptions;
}

export function cancellationCases(source) {
  const found = new Map();
  // These sections define cases; the overview and trace sections only refer to them.
  for (const [section, column] of [[6, 1], [8, 5], [9, 6], [11, 3]]) {
    for (const row of tableRows(sectionTokens(source, new RegExp(`^${section}\\.\\s`)))) {
      const id = row[column]?.replace(/[*`]/g, '').trim();
      if (/^TC-CANCEL-\d{2,}$/.test(id)) found.set(id, (found.get(id) ?? 0) + 1);
    }
  }
  return found;
}

export async function checkIds() {
  const errors = [];
  const defs = {};
  for (const [prefix, file] of Object.entries(canonical)) {
    const source = await read(file);
    defs[prefix] = definitions(source, prefix);
    if (prefix === 'TC') {
      const cancellation = await read('docs/02-nghiep-vu/chinh-sach-huy-hoan-coc.md');
      for (const [id, count] of cancellationCases(cancellation)) {
        defs.TC.set(id, (defs.TC.get(id) ?? 0) + count);
      }
    }
    if (!defs[prefix].size) errors.push(`${file}: no canonical ${prefix} definitions`);
    for (const [id, count] of defs[prefix]) if (count !== 1) errors.push(`${file}: ${id} defined ${count} times`);
  }
  for (const file of await markdownFiles()) {
    const lines = (await read(file)).split('\n');
    for (const [line, text] of lines.entries()) {
      try {
        for (const id of referencedIds(text)) {
          if (!defs[id.split('-')[0]].has(id)) errors.push(`${relative(file)}:${line + 1}: undefined ${id}`);
        }
      } catch (error) { errors.push(`${relative(file)}:${line + 1}: ${error.message}`); }
    }
  }

  const traceFile = 'docs/06-truy-vet/ma-tran-truy-vet.md';
  const trace = await read(traceFile);
  const rows = tableRows(sectionTokens(trace, /^2\.\s/));
  const exemptions = acceptedExemptions(trace);
  const columns = ['FR', 'UC', 'API', 'Entity', 'TC'];
  const seen = new Set();
  const usedExemptions = new Set();
  for (const row of rows) {
    const id = row[0]?.replace(/[*`]/g, '').trim();
    if (!/^BR-[A-Z]+-\d+$/.test(id)) continue;
    if (seen.has(id)) errors.push(`${traceFile}: duplicate trace row ${id}`);
    seen.add(id);
    if (!defs.BR.has(id)) errors.push(`${traceFile}: noncanonical trace row ${id}`);
    if (row.length !== 7) { errors.push(`${traceFile}: ${id}: expected seven columns`); continue; }
    for (const [i, column] of columns.entries()) {
      const value = row[i + 2].replace(/[*`]/g, '').trim();
      const present = column === 'API' ? /\/api\/v1\//.test(value)
        : column === 'Entity' ? /[A-Za-z][A-Za-z0-9]+/.test(value)
          : new RegExp(`\\b${column}-[A-Z]+-\\d{2,}\\b`).test(value);
      if (present) continue;
      const key = `${id}:${column}`;
      if (exemptions.has(key)) usedExemptions.add(key);
      else errors.push(`${traceFile}: ${id} lacks ${column} coverage and an accepted §6 exemption`);
    }
  }
  for (const id of defs.BR.keys()) if (!seen.has(id)) errors.push(`${traceFile}: missing trace row ${id}`);
  for (const key of exemptions.keys()) if (!usedExemptions.has(key)) errors.push(`${traceFile}: stale exemption ${key}; remove or update §6`);
  return { errors, summary: `${Object.entries(defs).map(([key, values]) => `${values.size} ${key}`).join(', ')}; ${seen.size} BR trace rows; ${usedExemptions.size} documented exemptions` };
}

if (process.argv[1]?.endsWith('check-ids.mjs')) {
  const result = await checkIds();
  report('IDs / trace', result.errors, result.summary);
}
