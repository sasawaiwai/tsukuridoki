// @ts-check
import { writeFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';

const SITE_URL = 'https://tsukuridoki.sasadokoro.online';

/**
 * sitemap.xml をビルド完了時に書き出す（仕様書46章）。パッケージを増やさないため自作。
 * /dev/ 以下（確認用ページ）・/dojin/tab/ 以下（トップのタブ用の部品）と 404 は含めない
 */
function sitemap() {
  return {
    name: 'tsukuridoki-sitemap',
    hooks: {
      /** @param {{ pages: { pathname: string }[], dir: URL }} options */
      'astro:build:done': ({ pages, dir }) => {
        const urls = pages
          .map((p) => p.pathname)
          .filter((path) => !path.startsWith('dev/') && !path.startsWith('dojin/tab/') && !path.startsWith('404'))
          .sort()
          .map((path) => `  <url><loc>${SITE_URL}/${path}</loc></url>`);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
        writeFileSync(new URL('sitemap.xml', dir), xml);
      },
    },
  };
}

export default defineConfig({
  site: SITE_URL,
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [sitemap()],
});
