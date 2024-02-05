import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig((env) => ({
  build: {
    target: ["es2020"],
    outDir: "dist",
    minify: false,
    watch: env.mode === "development" ? {} : undefined,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "Pilar",
      formats: ["es", "umd"],
      fileName: (format) => (format === "es" ? "index.mjs" : "index.js"),
    },
    rollupOptions: {},
  },
  plugins: [dts({ rollupTypes: true })],
}));
