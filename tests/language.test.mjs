import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('application HTML and frontend source contain no remaining Cyrillic UI text', async () => {
  const root = new URL('../', import.meta.url);
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /<html\s+lang="en"/);
  const files = ['index.html'];
  async function visit(path) {
    for (const entry of await readdir(new URL(path, root), { withFileTypes: true })) {
      const name = `${path}${entry.name}`;
      if (entry.isDirectory()) await visit(`${name}/`);
      else if (/\.(ts|css)$/.test(name)) files.push(name);
    }
  }
  await visit('src/');
  for (const file of files) {
    const text = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(text, /[\u0400-\u04ff]/u, `Non-English Cyrillic text in ${file}`);
  }
});
