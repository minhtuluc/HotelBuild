import { stat } from 'node:fs/promises';
import path from 'node:path';
import GithubSlugger from 'github-slugger';
import { JSDOM } from 'jsdom';
import { markdown, markdownFiles, read, relative, root, report } from './lib/docs.mjs';

export function anchors(source) {
  const slugger = new GithubSlugger();
  const tokens = markdown.parse(source, {});
  const ids = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'heading_open') {
      // Render inline markup to its visible text (links, code, emphasis, entities).
      const dom = new JSDOM(markdown.renderInline(tokens[i + 1].content));
      ids.add(slugger.slug(dom.window.document.body.textContent));
      dom.window.close();
    }
  }
  const dom = new JSDOM(markdown.render(source));
  for (const node of dom.window.document.querySelectorAll('[id], a[name]')) {
    if (node.id) ids.add(node.id);
    if (node.getAttribute('name')) ids.add(node.getAttribute('name'));
  }
  dom.window.close();
  return ids;
}

export async function checkLinks(files) {
  files ??= await markdownFiles();
  const errors = [];
  const cache = new Map();
  let checked = 0;
  for (const file of files) {
    const source = await read(file);
    const dom = new JSDOM(markdown.render(source));
    for (const node of dom.window.document.querySelectorAll('a[href], img[src]')) {
      const href = node.getAttribute(node.tagName === 'IMG' ? 'src' : 'href');
      if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
      checked++;
      try {
        const hash = href.indexOf('#');
        const targetPart = (hash < 0 ? href : href.slice(0, hash)).split('?')[0];
        const fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
        const target = !targetPart ? file : path.resolve(targetPart.startsWith('/') ? root : path.dirname(file), decodeURIComponent(targetPart).replace(/^\//, ''));
        const info = await stat(target);
        if (fragment && info.isFile() && /\.md$/i.test(target)) {
          if (!cache.has(target)) cache.set(target, anchors(await read(target)));
          if (!cache.get(target).has(fragment)) throw new Error(`missing anchor #${fragment}`);
        }
      } catch (error) {
        errors.push(`${relative(file)}: ${href}: ${error.code === 'ENOENT' ? 'missing target' : error.message}`);
      }
    }
    dom.window.close();
  }
  return { errors, checked };
}

if (process.argv[1]?.endsWith('check-links.mjs')) {
  const { errors, checked } = await checkLinks();
  report('Local links', errors, `${checked} local links and fragments checked`);
}
