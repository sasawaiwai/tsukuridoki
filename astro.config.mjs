// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://tsukuridoki.sasadokoro.online',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
