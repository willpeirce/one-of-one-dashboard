import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist/public');
await mkdir(resolve(output, 'fonts'), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: {
    browser: 'src/browser.ts',
    dashboard: 'src/dashboard-browser.ts',
    settings: 'src/settings-browser.ts',
  },
  outdir: output,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  logLevel: 'info',
});

const assets = [
  ['src/styles.css', 'styles.css'],
  ['src/dashboard.css', 'dashboard.css'],
  ['src/settings.css', 'settings.css'],
  ['docs/spec/logo.png', 'logo.png'],
  ['public/fonts.css', 'fonts.css'],
  ['public/manifest.webmanifest', 'manifest.webmanifest'],
  ['public/icon-192.png', 'icon-192.png'],
  ['public/icon-512.png', 'icon-512.png'],
  ['public/apple-touch-icon.png', 'apple-touch-icon.png'],
] as const;
await Promise.all(assets.map(([source, target]) => copyFile(resolve(root, source), resolve(output, target))));

for (const family of ['outfit', 'plus-jakarta-sans']) {
  const packageDirectory = resolve(root, 'node_modules/@fontsource-variable', family);
  await copyFile(
    resolve(packageDirectory, 'files', `${family}-latin-wght-normal.woff2`),
    resolve(output, 'fonts', `${family}-latin-wght-normal.woff2`),
  );
  await copyFile(resolve(packageDirectory, 'LICENSE'), resolve(output, 'fonts', `${family}-LICENSE.txt`));
}
