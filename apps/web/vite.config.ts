import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@rift/shared": path.resolve(
        __dirname,
        "../../packages/shared/src/index.ts"
      ),
    },
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    strictPort: true,
  },
  preview: {
    port: 4173,
    host: "0.0.0.0",
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});