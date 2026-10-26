import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * GitHub Pages project sites are served from /<repo>/, so every asset and
 * fetch must go through that prefix. BASE_PATH lets a custom domain use "/".
 */
const base = process.env.BASE_PATH ?? "/cusp-showdown/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { outDir: "dist", sourcemap: true },
  server: { port: 5173 },
});
