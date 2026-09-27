import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` -> dist/ (PWA, deployable anywhere).
// `npm run build:single` -> dist-single/index.html, one self-contained file.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), ...(mode === "single" ? [viteSingleFile()] : [])],
  build: mode === "single" ? { outDir: "dist-single", copyPublicDir: false } : { outDir: "dist" },
  define: mode === "single" ? { "import.meta.env.VITE_SINGLE_FILE": "true" } : {},
}));
