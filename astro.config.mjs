// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.gugugifts.com',
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [sitemap()],
});