import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// The icons reuse the header's own tokens: the sky edge to edge and the supplied mark drawn white, with no plate.
const root = fileURLToPath(new URL('../', import.meta.url));
const css = await readFile(resolve(root, 'src/dashboard.css'), 'utf8');

function token(name: string): string {
  const value = css.match(new RegExp(`--${name}:([^;]+);`))?.[1];
  if (!value) throw new Error(`src/dashboard.css has no --${name} token`);
  return value;
}

const logo = (await readFile(resolve(root, 'docs/spec/logo.png'))).toString('base64');
const icons = [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]] as const;

// Each size is drawn at its own pixels. The mark spans 70% of the width, inside iOS's rounded-corner mask.
const page = (size: number) => `<!doctype html><style>
html,body{margin:0;width:100%;height:100%}
body{display:grid;place-items:center;background:${token('sky')}}
img{display:block;width:${Math.round(size * 0.7)}px;height:auto;filter:${token('logo-filter')}}
</style><img src="data:image/png;base64,${logo}" alt="">`;

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});
try {
  for (const [name, size] of icons) {
    const tab = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await tab.setContent(page(size));
    await tab.locator('img').evaluate(image => (image as HTMLImageElement).decode());
    await tab.screenshot({ path: resolve(root, 'public', name), type: 'png' });
    await tab.close();
  }
} finally {
  await browser.close();
}
