import { defineConfig } from 'vite';

// For GitHub Pages the site lives at https://dthiger.github.io/Mira/, so
// production assets must resolve under `/Mira/`. Dev keeps the default `/`
// so `npm run dev` at `localhost:5174/` keeps working unchanged.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Mira/' : '/',
}));
