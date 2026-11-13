import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';

await mkdir('public', { recursive: true });
const html = await readFile('index.html', 'utf8');
await writeFile('public/index.html', html.replace('<html lang="en">', '<html lang="en" data-storage="cloud">'));
for (const file of ['app.js', 'charts.js', 'analytics.mjs', 'style.css']) {
  await copyFile(file, `public/${file}`);
}
for (const [source, target] of [
  ['node_modules/world-atlas/land-10m.json', 'land-10m.json'],
  ['node_modules/topojson-client/dist/topojson-client.min.js', 'topojson-client.js'],
  ['node_modules/world-atlas/LICENSE', 'world-atlas-license.txt'],
  ['node_modules/topojson-client/LICENSE', 'topojson-license.txt'],
]) await copyFile(source, `public/${target}`);
