import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config

export default defineConfig({
  site: 'https://hangba.github.io',
  integrations: [preact(), sitemap()],

  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },

  image: {
    responsiveStyles: true,
  },

  vite: {
    plugins: [tailwindcss()],
  },

  experimental: {
    svgo: true,
  },
});
