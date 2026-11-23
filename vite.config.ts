import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      "blinddeal-sdk": path.resolve(root, "sdk/src/index.ts"),
      buffer: "buffer",
    },
  },
  server: {
    host: "127.0.0.1",
    port: 47331,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 47331,
    strictPort: true,
  },
});
