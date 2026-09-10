import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// A relative base lets the same bundle run on Workers and a GitHub Pages subpath.
export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  base: "./",
  plugins: [vue()],
  publicDir: "static",
  build: {
    outDir: "../public/dashboard",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
  server: { host: "127.0.0.1" },
});
