import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

import { releaseVersion } from './release.mjs';

const directory = 'cloudflare/public';
await mkdir(directory + '/fonts', {recursive:true});
for (const file of ['pdf-vector.js', 'v13-core.js']) await copyFile(file, directory + '/' + file);
const html = await readFile('index.html','utf8');
const cloudHtml = html
  .replace(/(<span class="build-version"[^>]*>)[^<]*/, (_, tag) => tag + releaseVersion)
  .replace('Download Full Backup (.tar.gz) — boards + original images', 'Download board data (.json)')
  .replace('Preparing full backup including original photos', 'Downloading board data')
  .replace(/^.*cloudIndicator.*Sign out.*\n/m, '');
await writeFile(directory + '/index.html', cloudHtml);
for (const subset of ['thai', 'latin']) {
  for (const weight of [300, 400, 500, 600, 700, 800]) {
    const file = `prompt-${subset}-${weight}-normal.woff2`;
    await copyFile('node_modules/@fontsource/prompt/files/' + file, directory + '/fonts/' + file);
  }
}
let css = '';
for (const weight of [300, 400, 500, 600, 700, 800]) {
  const weightCss = await readFile(`node_modules/@fontsource/prompt/${weight}.css`,'utf8');
  css += weightCss.replaceAll('./files/', '/fonts/').replace(/,?\s*url\([^)]*\.woff\) format\('woff'\)/g, '');
}
await writeFile(directory + '/fonts/prompt.css',css);
